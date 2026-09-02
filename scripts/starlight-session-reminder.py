#!/usr/bin/env python3
"""Send a timed reminder when a Starlight session falls in the configured window.

The day mode is designed for a Friday-afternoon cron and looks 20-32 hours
ahead. The hour mode is designed for a Saturday 2:00 pm ET cron and looks
45-75 minutes ahead. If no session is found, the command exits quietly.

--dry-run shows what would happen without sending.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

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


def main() -> None:
    dev_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timing", choices=["day", "hour"], default="day")
    parser.add_argument("--supabase-env", type=Path, default=dev_root / "email-marketing-tool-1/.env")
    args = parser.parse_args()

    env = parse_env(args.supabase_env)
    supabase_url = (env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_KEY") or ""
    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    def rest(path: str):
        request = urllib.request.Request(f"{supabase_url}/rest/v1/{path}", headers=headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)

    now = datetime.now(timezone.utc)
    if args.timing == "hour":
        window_start = (now + timedelta(minutes=45)).strftime("%Y-%m-%dT%H:%M:%SZ")
        window_end = (now + timedelta(minutes=75)).strftime("%Y-%m-%dT%H:%M:%SZ")
        template = "session_1h"
    else:
        window_start = (now + timedelta(hours=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
        window_end = (now + timedelta(hours=32)).strftime("%Y-%m-%dT%H:%M:%SZ")
        template = "session"
    course = rest(f"cfa_learn_courses?slug=eq.{COURSE_SLUG}&select=id")[0]["id"]
    sessions = rest(
        f"cfa_learn_sessions?course_id=eq.{course}&published=is.true"
        f"&starts_at=gte.{window_start}&starts_at=lte.{window_end}"
        "&select=slug,presenter,title,starts_at,ends_at&order=starts_at&limit=1"
    )
    if not sessions:
        print(json.dumps({"result": "no_session_tomorrow"}))
        return

    session = sessions[0]
    eastern = ZoneInfo("America/New_York")
    starts = datetime.fromisoformat(session["starts_at"]).astimezone(eastern)
    ends = datetime.fromisoformat(session["ends_at"]).astimezone(eastern) if session.get("ends_at") else None
    time_part = (
        f"{starts.strftime('%-I:%M')}–{ends.strftime('%-I:%M %p')}" if ends else starts.strftime("%-I:%M %p")
    )
    session_line = (
        f"{starts.strftime('%A, %B %-d')}, {time_part} Eastern, with {session['presenter']}"
    )
    print(json.dumps({
        "result": "session_found",
        "timing": args.timing,
        "session": session["slug"],
        "session_line": session_line,
    }))

    command = [
        sys.executable,
        str(Path(__file__).with_name("starlight-remind.py")),
        template,
        "--session-line", session_line,
        "--session-slug", session["slug"],
    ]
    if not args.dry_run:
        command += ["--apply", "--confirm-template", template]
    completed = subprocess.run(command, capture_output=True, text=True)
    print(completed.stdout.strip())
    if completed.returncode != 0:
        print(completed.stderr.strip(), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
