#!/usr/bin/env python3
"""Tag migrated Starlight roster enrollments as group registrations.

Dry-run by default. Pass --apply to merge the group fields into enrollment
raw_data without replacing any existing migration or Thinkific metadata.
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROGRAM_ID = "bcbe97e6-337b-478a-8a57-59dd7f30211f"
GROUPS = {
    "halton-waldorf": {
        "registration_type": "group",
        "group_name": "Halton Waldorf School",
        "group_payment_type": "institutional_payment",
    },
    "lotus-and-ivy": {
        "registration_type": "group",
        "group_name": "Lotus & Ivy",
        "group_payment_type": "institutional_payment",
    },
    "whistep-students": {
        "registration_type": "group",
        "group_name": "WHiSTEP",
        "group_payment_type": "sponsored_cohort",
    },
}


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def request_json(
    url: str,
    headers: dict[str, str],
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> Any:
    request_headers = dict(headers)
    data = None
    if body is not None:
        request_headers["Content-Type"] = "application/json"
        request_headers["Prefer"] = "return=minimal"
        data = json.dumps(body).encode()
    request = urllib.request.Request(url, headers=request_headers, method=method, data=data)
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw.strip() else None


def main() -> None:
    dev_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--supabase-env",
        type=Path,
        default=dev_root / "email-marketing-tool-1/.env",
    )
    args = parser.parse_args()

    env = parse_env(args.supabase_env)
    supabase_url = (env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_KEY") or ""
    if not supabase_url or not service_key:
        raise RuntimeError("Supabase URL or service key missing")
    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    query = urllib.parse.urlencode({
        "program_id": f"eq.{PROGRAM_ID}",
        "select": "id,raw_data,revoked_at",
    })
    rows = request_json(f"{supabase_url}/rest/v1/enrollments?{query}", headers) or []
    targets = [
        row for row in rows
        if (row.get("raw_data") or {}).get("source_roster") in GROUPS
    ]
    changed = []
    for row in targets:
        raw_data = dict(row.get("raw_data") or {})
        source_roster = raw_data["source_roster"]
        expected = GROUPS[source_roster]
        if all(raw_data.get(key) == value for key, value in expected.items()):
            continue
        changed.append(row)
        if args.apply:
            raw_data.update(expected)
            row_query = urllib.parse.urlencode({"id": f"eq.{row['id']}"})
            request_json(
                f"{supabase_url}/rest/v1/enrollments?{row_query}",
                headers,
                method="PATCH",
                body={
                    "raw_data": raw_data,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )

    print(json.dumps({
        "mode": "applied" if args.apply else "dry_run",
        "matched": len(targets),
        "changed": len(changed),
        "active": sum(not row.get("revoked_at") for row in targets),
        "revoked": sum(bool(row.get("revoked_at")) for row in targets),
        "groups": dict(Counter(
            (row.get("raw_data") or {}).get("source_roster") for row in targets
        )),
    }, indent=2))


if __name__ == "__main__":
    main()
