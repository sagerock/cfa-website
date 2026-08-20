#!/usr/bin/env python3
"""Send a season email to the Starlight roster via cfa-learn-remind.

Dry-run by default: lists who would receive what, sends nothing.
  --send-test EMAIL   sends ONE real email (first enrollee's content) to EMAIL.
  --apply             sends to the full active roster. Requires --confirm-template.

Templates:
  launch   "begins this Saturday" + personal classroom link (the Aug 31 email)
  session  T-24h reminder with the Zoom link in the email

Example session line: "September 5, 3:00-4:30 pm Eastern, with Dr. Martyn Rawson"
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
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
    parser.add_argument("template", choices=["launch", "session"])
    parser.add_argument("--session-line", required=True,
                        help='e.g. "September 5, 3:00-4:30 pm Eastern, with Dr. Martyn Rawson"')
    parser.add_argument("--send-test", metavar="EMAIL",
                        help="send one real email (first enrollee's content) to this address")
    parser.add_argument("--apply", action="store_true", help="send to the full active roster")
    parser.add_argument("--confirm-template", help="must repeat the template name when using --apply")
    parser.add_argument("--supabase-env", type=Path, default=dev_root / "email-marketing-tool-1/.env")
    parser.add_argument("--ops-token-env", type=Path, default=Path("/mnt/d/dev/secrets/cfa-learn-ops.env"))
    args = parser.parse_args()

    env = parse_env(args.supabase_env)
    supabase_url = (env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_KEY") or ""
    ops_token = parse_env(args.ops_token_env).get("CFA_LEARN_OPS_TOKEN", "")
    if not supabase_url or not service_key or not ops_token:
        raise RuntimeError("Supabase URL, service key, or ops token missing")
    rest_headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    def rest(path: str) -> Any:
        status, payload = request_json(f"{supabase_url}/rest/v1/{path}", rest_headers)
        if status != 200:
            raise RuntimeError(f"REST {path.split('?')[0]} failed: {status}")
        return payload

    program_id = rest(f"cfa_learn_courses?slug=eq.{COURSE_SLUG}&select=program_id")[0]["program_id"]
    enrollments = rest(
        f"enrollments?client_id=eq.{CFA_CLIENT_ID}&program_id=eq.{program_id}"
        "&status=eq.registered&revoked_at=is.null&select=id,contact_id&order=enrolled_at"
    )
    contact_ids = ",".join(sorted({e["contact_id"] for e in enrollments}))
    contacts = {
        c["id"]: c
        for c in rest(f"contacts?client_id=eq.{CFA_CLIENT_ID}&id=in.({contact_ids})&select=id,email,first_name,last_name")
    }
    roster = [
        {
            "enrollment_id": e["id"],
            "email": contacts[e["contact_id"]]["email"],
            "name": f'{contacts[e["contact_id"]].get("first_name") or ""} {contacts[e["contact_id"]].get("last_name") or ""}'.strip(),
        }
        for e in enrollments
        if e["contact_id"] in contacts
    ]

    def send(enrollment_id: str, override: str | None = None) -> tuple[int, Any]:
        body: dict[str, Any] = {
            "enrollment_id": enrollment_id,
            "template": args.template,
            "session_line": args.session_line,
        }
        if override:
            body["override_recipient"] = override
        return request_json(
            f"{supabase_url}/functions/v1/cfa-learn-remind",
            {"Content-Type": "application/json", "X-Cfa-Ops-Token": ops_token},
            method="POST",
            body=body,
        )

    if args.send_test:
        status, result = send(roster[0]["enrollment_id"], override=args.send_test)
        print(json.dumps({"mode": "test_send", "to": args.send_test, "status": status, "result": result}, indent=2))
        return

    if not args.apply:
        print(json.dumps({
            "mode": "dry_run",
            "template": args.template,
            "session_line": args.session_line,
            "recipients": len(roster),
            "sample": [r["email"] for r in roster[:5]],
        }, indent=2))
        return

    if args.confirm_template != args.template:
        raise RuntimeError("--apply requires --confirm-template to repeat the template name")

    sent, failed = 0, []
    for row in roster:
        status, result = send(row["enrollment_id"])
        if status == 200 and result.get("ok"):
            sent += 1
        else:
            failed.append({"email": row["email"], "status": status, "error": result.get("error")})
        time.sleep(0.4)  # stay well under SendGrid and function rate limits
    print(json.dumps({
        "mode": "applied",
        "template": args.template,
        "sent": sent,
        "failed": failed,
        "total": len(roster),
    }, indent=2))


if __name__ == "__main__":
    main()
