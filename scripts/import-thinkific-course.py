#!/usr/bin/env python3
"""Import any Thinkific course's roster into the central contacts/enrollments
model — the customer-intelligence backfill ahead of Thinkific's Nov 10 lapse.

For each course: ensures a `programs` row (platform thinkific, platform_id =
course id), pulls the live enrollment list read-only, and runs the same
transactional batch RPC used for Starlight and Explorations. Contacts are
matched by exact email, so a person's enrollments across courses accumulate
on one contact record. Creates no Auth users, sends no email.

Usage:
  import-thinkific-course.py --list                 dry-run summary of every course
  import-thinkific-course.py --course-id 3028866    dry-run one course
  import-thinkific-course.py --course-id 3028866 --apply
  import-thinkific-course.py --all --apply          apply every course not yet imported
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd"
TODAY = datetime.date.today().isoformat()


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
    for attempt in range(4):
        request = urllib.request.Request(url, headers=headers, method=method, data=data)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read()
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 3:
                import time
                time.sleep(int(error.headers.get("Retry-After", "3")))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 3:
                import time
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError("retry loop exhausted")


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:80] or "course"


class Importer:
    def __init__(self, thinkific_env: Path, supabase_env: Path):
        tenv = parse_env(thinkific_env)
        self.th = {
            "X-Auth-API-Key": tenv["THINKIFIC_API_KEY"],
            "X-Auth-Subdomain": tenv["THINKIFIC_SUBDOMAIN"],
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) cfa-ops/1.0",
        }
        senv = parse_env(supabase_env)
        self.supabase_url = (senv.get("SUPABASE_URL") or senv.get("VITE_SUPABASE_URL") or "").rstrip("/")
        service_key = senv.get("SUPABASE_SERVICE_ROLE_KEY") or senv.get("SUPABASE_SERVICE_KEY") or ""
        self.sh = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def thinkific(self, path: str, **params: Any) -> Any:
        query = "?" + urllib.parse.urlencode(params) if params else ""
        return request_json(f"https://api.thinkific.com/api/public/v1{path}{query}", self.th)

    def thinkific_pages(self, path: str, **params: Any) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = 1
        while True:
            payload = self.thinkific(path, page=page, limit=250, **params)
            items.extend(payload.get("items", []))
            if not payload.get("meta", {}).get("pagination", {}).get("next_page"):
                return items
            page += 1

    def rest(self, path: str, method: str = "GET", body: Any | None = None) -> Any:
        return request_json(f"{self.supabase_url}/rest/v1/{path}", self.sh, method, body)

    def courses(self) -> list[dict[str, Any]]:
        return self.thinkific_pages("/courses")

    def ensure_program(self, course: dict[str, Any], apply: bool) -> dict[str, Any] | None:
        existing = self.rest(
            f"programs?client_id=eq.{CFA_CLIENT_ID}&platform=eq.thinkific"
            f"&platform_id=eq.{course['id']}&select=id,name"
        )
        if existing:
            return existing[0]
        if not apply:
            return None
        name = course["name"].strip()
        year_match = re.search(r"(20\d\d)", name)
        created = self.rest("programs", "POST", {
            "client_id": CFA_CLIENT_ID,
            "name": name,
            "year": int(year_match.group(1)) if year_match else datetime.date.today().year,
            "format": "online",
            "platform": "thinkific",
            "platform_id": str(course["id"]),
            "tag": slugify(name),
        })
        return created[0]

    def build_rows(self, course_id: int, batch_id: str) -> list[dict[str, Any]]:
        rows, seen = [], set()
        for enrollment in self.thinkific_pages("/enrollments", **{"query[course_id]": course_id}):
            enrollment_id = str(enrollment.get("id") or "")
            email = (enrollment.get("user_email") or "").strip().lower()
            if not enrollment_id or not email or enrollment_id in seen:
                continue
            seen.add(enrollment_id)
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
                    "migration_batch_id": batch_id,
                    "thinkific": {
                        "activated_at": enrollment.get("activated_at"),
                        "free_trial": enrollment.get("is_free_trial"),
                        "completed_at": enrollment.get("completed_at"),
                        "percentage_completed": enrollment.get("percentage_completed"),
                    },
                },
            })
        return rows

    def course_status(self, course: dict[str, Any]) -> dict[str, Any]:
        program = self.ensure_program(course, apply=False)
        imported = 0
        if program:
            refs = self.rest(
                f"enrollments?program_id=eq.{program['id']}&source=eq.thinkific&select=id"
            )
            imported = len(refs)
        payload = self.thinkific("/enrollments", **{"query[course_id]": course["id"], "page": 1, "limit": 1})
        total = payload.get("meta", {}).get("pagination", {}).get("total_items", 0)
        return {
            "course_id": course["id"],
            "name": course["name"],
            "thinkific_enrollments": total,
            "already_imported": imported,
            "has_program_row": program is not None,
        }

    def import_course(self, course: dict[str, Any], apply: bool) -> dict[str, Any]:
        batch_id = f"thinkific-{course['id']}-{TODAY}"
        rows = self.build_rows(course["id"], batch_id)
        program = self.ensure_program(course, apply)
        summary: dict[str, Any] = {
            "course": course["name"],
            "course_id": course["id"],
            "rows": len(rows),
            "batch_id": batch_id,
        }
        if not rows:
            summary["result"] = "empty_course_skipped"
            return summary
        if not apply:
            summary["result"] = "dry_run"
            return summary
        result = request_json(
            f"{self.supabase_url}/rest/v1/rpc/cfa_import_thinkific_enrollment_batch",
            self.sh,
            method="POST",
            body={
                "requested_batch_id": batch_id,
                "requested_client_id": CFA_CLIENT_ID,
                "requested_program_id": program["id"],
                "requested_rows": rows,
            },
        )
        summary["result"] = result
        return summary


def main() -> None:
    dev_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true", help="summary of every course")
    parser.add_argument("--course-id", type=int)
    parser.add_argument("--all", action="store_true", help="every course with no prior import")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--supabase-env", type=Path, default=dev_root / "email-marketing-tool-1/.env")
    parser.add_argument(
        "--thinkific-env", type=Path,
        default=dev_root / "sagerock/clients/center-for-anthroposophy/thinkific-mcp/.env",
    )
    args = parser.parse_args()

    importer = Importer(args.thinkific_env, args.supabase_env)
    courses = importer.courses()

    if args.list:
        print(json.dumps([importer.course_status(c) for c in courses], indent=2))
        return

    if args.course_id:
        targets = [c for c in courses if c["id"] == args.course_id]
    elif args.all:
        targets = [c for c in courses if importer.course_status(c)["already_imported"] == 0]
    else:
        raise RuntimeError("pass --list, --course-id, or --all")

    results = [importer.import_course(c, args.apply) for c in targets]
    print(json.dumps({"mode": "applied" if args.apply else "dry_run", "courses": results}, indent=2))


if __name__ == "__main__":
    main()
