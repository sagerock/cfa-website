#!/usr/bin/env python3
"""Import the Explorations Online Fall 2026-2027 Thinkific roster into the
central contacts/enrollments model. Mirrors the Starlight import: live
read-only pull from Thinkific, exact-email contact matching, one transactional
batch RPC, Thinkific enrollment ids as lineage, dry-run unless confirmed.

Creates no Auth users and sends no email — participants stay in Thinkific
untouched (the parallel-run decision, 2026-08-22)."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

BATCH_ID = "explorations-fall-thinkific-2026-08-22"
THINKIFIC_COURSE_ID = 3399825
THINKIFIC_PLATFORM_ID = "3399825"
CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd"
TAG = "explorations-fall-2026-2027"


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def request_json(url: str, headers: dict[str, str], method: str = "GET", body: Any | None = None) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, headers=headers, method=method, data=data)
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read()
        return json.loads(raw) if raw.strip() else {}


def main() -> None:
    dev_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-batch-id")
    parser.add_argument("--supabase-env", type=Path, default=dev_root / "email-marketing-tool-1/.env")
    parser.add_argument(
        "--thinkific-env", type=Path,
        default=dev_root / "sagerock/clients/center-for-anthroposophy/thinkific-mcp/.env",
    )
    args = parser.parse_args()

    tenv = parse_env(args.thinkific_env)
    thinkific_headers = {
        "X-Auth-API-Key": tenv["THINKIFIC_API_KEY"],
        "X-Auth-Subdomain": tenv["THINKIFIC_SUBDOMAIN"],
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) cfa-ops/1.0",
    }
    senv = parse_env(args.supabase_env)
    supabase_url = (senv.get("SUPABASE_URL") or senv.get("VITE_SUPABASE_URL") or "").rstrip("/")
    service_key = senv.get("SUPABASE_SERVICE_ROLE_KEY") or senv.get("SUPABASE_SERVICE_KEY") or ""
    rest_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    def rest(path: str) -> Any:
        return request_json(f"{supabase_url}/rest/v1/{path}", rest_headers)

    programs = rest(
        f"programs?client_id=eq.{CFA_CLIENT_ID}&platform=eq.thinkific"
        f"&platform_id=eq.{THINKIFIC_PLATFORM_ID}&select=id,name"
    )
    if len(programs) != 1:
        raise RuntimeError(f"expected exactly one program for platform_id {THINKIFIC_PLATFORM_ID}, found {len(programs)}")
    program = programs[0]

    # Live Thinkific roster (read-only)
    enrollments: list[dict[str, Any]] = []
    page = 1
    while True:
        payload = request_json(
            "https://api.thinkific.com/api/public/v1/enrollments?"
            + urllib.parse.urlencode({"query[course_id]": THINKIFIC_COURSE_ID, "page": page, "limit": 250}),
            thinkific_headers,
        )
        enrollments.extend(payload.get("items", []))
        if not payload.get("meta", {}).get("pagination", {}).get("next_page"):
            break
        page += 1

    seen_ids: set[str] = set()
    rows = []
    for enrollment in enrollments:
        enrollment_id = str(enrollment.get("id") or "")
        email = (enrollment.get("user_email") or "").strip().lower()
        if not enrollment_id or not email or enrollment_id in seen_ids:
            continue
        seen_ids.add(enrollment_id)
        full_name = (enrollment.get("user_name") or "").strip()
        first, _, last = full_name.partition(" ")
        rows.append({
            "email": email,
            "first_name": first or full_name or "Participant",
            "last_name": last or "",
            "thinkific_user_id": str(enrollment.get("user_id") or ""),
            "school": None,
            "phone": None,
            "possible_duplicate_emails": None,
            "platform_enrollment_id": enrollment_id,
            "enrolled_at": enrollment.get("created_at"),
            "access_starts_at": enrollment.get("started_at") or enrollment.get("created_at"),
            "access_ends_at": enrollment.get("expiry_date"),
            "raw_data": {
                "migration_batch_id": BATCH_ID,
                "thinkific": {
                    "activated_at": enrollment.get("activated_at"),
                    "free_trial": enrollment.get("is_free_trial"),
                    "completed_at": enrollment.get("completed_at"),
                    "percentage_completed": enrollment.get("percentage_completed"),
                },
            },
        })

    emails = [r["email"] for r in rows]
    existing: set[str] = set()
    for i in range(0, len(emails), 60):
        chunk = ",".join(f'"{e}"' for e in emails[i:i + 60])
        found = rest(
            f"contacts?client_id=eq.{CFA_CLIENT_ID}&email=in.({urllib.parse.quote(chunk)})&select=email"
        )
        existing.update(c["email"].lower() for c in found)
    already_enrolled = rest(
        f"enrollments?program_id=eq.{program['id']}&source=eq.thinkific&select=source_reference"
    )
    already_refs = {str(r["source_reference"]) for r in already_enrolled}

    preview = {
        "batch_id": BATCH_ID,
        "program": program["name"],
        "thinkific_enrollments": len(rows),
        "contacts_to_reuse": sum(1 for e in emails if e in existing),
        "contacts_to_create": sum(1 for e in emails if e not in existing),
        "enrollments_already_imported": sum(1 for r in rows if r["platform_enrollment_id"] in already_refs),
        "auth_users_created": 0,
        "emails_sent": 0,
    }
    if not args.apply:
        print(json.dumps({"mode": "dry_run", **preview}, indent=2))
        return
    if args.confirm_batch_id != BATCH_ID:
        raise RuntimeError(f"--confirm-batch-id must equal {BATCH_ID}")

    result = request_json(
        f"{supabase_url}/rest/v1/rpc/cfa_import_thinkific_enrollment_batch",
        rest_headers,
        method="POST",
        body={
            "requested_batch_id": BATCH_ID,
            "requested_client_id": CFA_CLIENT_ID,
            "requested_program_id": program["id"],
            "requested_rows": rows,
        },
    )
    imported = rest(
        f"enrollments?program_id=eq.{program['id']}&source=eq.thinkific&select=source_reference,status"
    )
    imported_refs = {str(r["source_reference"]) for r in imported}
    expected_refs = {r["platform_enrollment_id"] for r in rows}
    if not expected_refs.issubset(imported_refs):
        raise RuntimeError("post-import lineage mismatch")
    print(json.dumps({
        "mode": "applied",
        "rpc_result": result,
        "verified_enrollments": len(imported),
        **preview,
    }, indent=2))


if __name__ == "__main__":
    main()
