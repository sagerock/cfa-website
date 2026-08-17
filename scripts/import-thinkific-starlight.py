#!/usr/bin/env python3
"""Apply the reviewed Starlight import plan; dry-run unless explicitly confirmed."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


BATCH_ID = "starlight-thinkific-2026-08-16"


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def request_json(
    url: str,
    headers: dict[str, str],
    method: str = "GET",
    body: Any | None = None,
) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, headers=headers, method=method, data=data)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase HTTP {error.code}: {detail}") from error


def supabase_list(
    base_url: str,
    table: str,
    headers: dict[str, str],
    params: dict[str, str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        query = {**params, "limit": "1000", "offset": str(offset)}
        payload = request_json(
            f"{base_url}/rest/v1/{table}?{urllib.parse.urlencode(query)}",
            headers,
        )
        rows.extend(payload)
        if len(payload) < 1000:
            return rows
        offset += len(payload)


def main() -> None:
    dev_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--plan",
        type=Path,
        default=Path("migration-audits/private/starlight-rays-2026-2027/import-plan.json"),
    )
    parser.add_argument(
        "--supabase-env",
        type=Path,
        default=dev_root / "email-marketing-tool-1/.env",
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-batch-id")
    args = parser.parse_args()

    plan = json.loads(args.plan.read_text())
    if len(plan) != 74 or any(record["status"] != "ready" for record in plan):
        raise RuntimeError("Plan must contain exactly 74 ready records")
    client_ids = {record["enrollment"]["client_id"] for record in plan}
    program_ids = {record["enrollment"]["program_id"] for record in plan}
    source_ids = {record["enrollment"]["source_reference"] for record in plan}
    if len(client_ids) != 1 or len(program_ids) != 1 or len(source_ids) != len(plan):
        raise RuntimeError("Plan identity or lineage validation failed")

    payload_rows = []
    for record in plan:
        contact = record["contact"]
        enrollment = record["enrollment"]
        payload_rows.append({
            "email": contact["email"],
            "first_name": contact["first_name"],
            "last_name": contact["last_name"],
            "thinkific_user_id": contact["custom_fields"]["thinkific_user_id"],
            "school": contact["custom_fields"]["school"],
            "phone": contact["custom_fields"]["phone"],
            "possible_duplicate_emails": contact["custom_fields"]["possible_duplicate_emails"],
            "platform_enrollment_id": enrollment["platform_enrollment_id"],
            "enrolled_at": enrollment["enrolled_at"],
            "access_starts_at": enrollment["access_starts_at"],
            "access_ends_at": enrollment["access_ends_at"],
            "raw_data": enrollment["raw_data"],
        })

    preview = {
        "batch_id": BATCH_ID,
        "rows": len(payload_rows),
        "contacts_to_create": sum(record["action"].startswith("create_contact") for record in plan),
        "contacts_to_reuse": sum(record["action"].startswith("reuse_contact") for record in plan),
        "enrollment_upserts": len(plan),
        "auth_users": 0,
    }
    if not args.apply:
        print(json.dumps({"mode": "dry_run", **preview}, indent=2))
        return
    if args.confirm_batch_id != BATCH_ID:
        raise RuntimeError(f"--confirm-batch-id must equal {BATCH_ID}")

    env = parse_env(args.supabase_env)
    supabase_url = (env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_KEY") or ""
    if not supabase_url or not service_key:
        raise RuntimeError("Supabase URL or service-role key is missing")
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    result = request_json(
        f"{supabase_url}/rest/v1/rpc/cfa_import_thinkific_enrollment_batch",
        headers,
        method="POST",
        body={
            "requested_batch_id": BATCH_ID,
            "requested_client_id": next(iter(client_ids)),
            "requested_program_id": next(iter(program_ids)),
            "requested_rows": payload_rows,
        },
    )

    program_id = next(iter(program_ids))
    imported = supabase_list(
        supabase_url,
        "enrollments",
        headers,
        {
            "program_id": f"eq.{program_id}",
            "source": "eq.thinkific",
            "select": "id,contact_id,platform_enrollment_id,source_reference,status,raw_data",
        },
    )
    imported_source_ids = {str(row["source_reference"]) for row in imported}
    if imported_source_ids != source_ids:
        raise RuntimeError(
            f"Post-import lineage mismatch: expected {len(source_ids)}, found {len(imported_source_ids)}"
        )
    if any(row["status"] != "registered" for row in imported):
        raise RuntimeError("Post-import enrollment status mismatch")

    print(json.dumps({
        "mode": "applied",
        "rpc_result": result,
        "verified_enrollments": len(imported),
        "verified_unique_source_references": len(imported_source_ids),
        "auth_users_created": 0,
    }, indent=2))


if __name__ == "__main__":
    main()
