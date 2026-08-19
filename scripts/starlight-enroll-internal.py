#!/usr/bin/env python3
"""Enroll one internal/staff person in Starlight Rays and send their welcome email.

This is the ops path for people who join outside a payment or roster import
(demo walkthroughs, staff, comped access). Dry-run by default; --apply executes.

Steps on apply:
  1. Find or create the CfA contact for the email.
  2. Upsert a central enrollment (status registered, source manual).
  3. Call cfa-learn-welcome, which ensures the Auth user and identity bridge,
     mints the sign-in link, sends the co-signed welcome email, and records the
     delivery in cfa_learn_email_events.

Prints sanitized results only. Never prints tokens or links.
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd"
COURSE_SLUG = "starlight-rays-2026-2027"


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def request_json(url: str, headers: dict[str, str], method: str = "GET", body: Any | None = None) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, headers=headers, method=method, data=data)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            return error.code, json.loads(detail)
        except json.JSONDecodeError:
            return error.code, {"raw": detail[:200]}


def main() -> None:
    dev_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("email")
    parser.add_argument("--first-name", required=True)
    parser.add_argument("--last-name", required=True)
    parser.add_argument("--source-reference", default="starlight-internal")
    parser.add_argument("--role", default="internal", help="stored in enrollment raw_data")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--supabase-env", type=Path, default=dev_root / "email-marketing-tool-1/.env")
    parser.add_argument("--ops-token-env", type=Path, default=Path("/mnt/d/dev/secrets/cfa-learn-ops.env"))
    args = parser.parse_args()

    email = args.email.strip().lower()
    env = parse_env(args.supabase_env)
    supabase_url = (env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_KEY") or ""
    ops_token = parse_env(args.ops_token_env).get("CFA_LEARN_OPS_TOKEN", "")
    if not supabase_url or not service_key or not ops_token:
        raise RuntimeError("Supabase URL, service key, or ops token missing")
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    def rest(path: str, method: str = "GET", body: Any | None = None) -> Any:
        status, payload = request_json(f"{supabase_url}/rest/v1/{path}", headers, method, body)
        if status not in (200, 201):
            raise RuntimeError(f"{method} {path.split('?')[0]} failed: {status} {payload}")
        return payload

    program_id = rest(f"cfa_learn_courses?slug=eq.{COURSE_SLUG}&select=program_id")[0]["program_id"]
    quoted = urllib.parse.quote(email)
    contacts = rest(f"contacts?client_id=eq.{CFA_CLIENT_ID}&email=eq.{quoted}&select=id,first_name,last_name")
    enrollment = None
    if contacts:
        rows = rest(
            f"enrollments?contact_id=eq.{contacts[0]['id']}&program_id=eq.{program_id}"
            "&select=id,status,revoked_at"
        )
        enrollment = rows[0] if rows else None

    plan = {
        "email": email,
        "contact": "reuse" if contacts else "create",
        "enrollment": "exists" if enrollment else "create (registered, source=manual)",
        "welcome_email": "send via cfa-learn-welcome",
    }
    if not args.apply:
        print(json.dumps({"mode": "dry_run", **plan}, indent=2))
        return

    if contacts:
        contact_id = contacts[0]["id"]
    else:
        contact_id = rest("contacts", "POST", {
            "client_id": CFA_CLIENT_ID,
            "email": email,
            "first_name": args.first_name,
            "last_name": args.last_name,
            "source_code": args.source_reference,
            "tags": [COURSE_SLUG],
        })[0]["id"]

    if enrollment is None:
        enrollment = rest("enrollments", "POST", {
            "client_id": CFA_CLIENT_ID,
            "program_id": program_id,
            "contact_id": contact_id,
            "status": "registered",
            "source": "manual",
            "source_reference": args.source_reference,
            "enrolled_at": "now()",
            "access_starts_at": "now()",
            "raw_data": {"role": args.role},
        })[0]
    elif enrollment.get("status") != "registered" or enrollment.get("revoked_at"):
        raise RuntimeError(f"existing enrollment is not active: {enrollment}")

    status, welcome = request_json(
        f"{supabase_url}/functions/v1/cfa-learn-welcome",
        {"Content-Type": "application/json", "X-Cfa-Ops-Token": ops_token},
        method="POST",
        body={"enrollment_id": enrollment["id"]},
    )
    print(json.dumps({
        "mode": "applied",
        "email": email,
        "contact_id": contact_id,
        "enrollment_id": enrollment["id"],
        "welcome_status": status,
        "welcome": welcome,
    }, indent=2))


if __name__ == "__main__":
    main()
