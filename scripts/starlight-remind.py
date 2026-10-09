#!/usr/bin/env python3
"""Send a season email to the Starlight roster via cfa-learn-remind.

Dry-run by default: lists who would receive what, sends nothing.
  --send-test EMAIL   sends ONE real email (first enrollee's content) to EMAIL.
  --apply             sends to the full active roster. Requires --confirm-template.

Templates:
  launch   "begins this Saturday" + personal classroom link (the Aug 31 email)
  session  T-24h reminder with the Zoom link in the email
  session_1h  T-1h reminder with the Zoom link in the email

Example session line: "September 5, 3:00-4:30 pm Eastern, with Dr. Martyn Rawson"
"""

from __future__ import annotations

import argparse
import http.client
import json
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd"
COURSE_SLUG = "starlight-rays-2026-2027"
NOTIFICATION_EXCLUDED_EMAILS = {"sage@sagerock.com"}
REQUIRED_ONE_HOUR_RECIPIENTS = {
    "david@centerforanthroposophy.org",
    "elsy@centerforanthroposophy.org",
    "sage@centerforanthroposophy.org",
}


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


# A transient network blip used to end the whole send. On 2026-10-09 the Friday
# T-24h run reached recipient 139 of 263 and a single TLS handshake timeout to
# Supabase raised URLError out of the loop, so the remaining 125 people got no
# Zoom link for a session the next afternoon and the summary that names who was
# missed was never printed either. Transport failures and 429/5xx are retried in
# place; everything else (401, 404, a real 400 from the function) still fails on
# the first try, because those are not going to get better by waiting.
RETRY_ATTEMPTS = 4
RETRY_BACKOFF_SECONDS = (2, 6, 15)  # 23s of waiting, 4 x 60s of timeout worst case
TRANSIENT_EXCEPTIONS = (
    urllib.error.URLError,  # covers the ssl handshake timeout that broke 2026-10-09
    socket.timeout,
    ssl.SSLError,
    http.client.HTTPException,
    ConnectionError,
    TimeoutError,
)


def request_json(
    url: str,
    headers: dict[str, str],
    method: str = "GET",
    body: Any | None = None,
    attempts: int = RETRY_ATTEMPTS,
) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers=headers, method=method, data=data)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            try:
                payload: Any = json.loads(detail)
            except json.JSONDecodeError:
                payload = {"raw": detail[:200]}
            if error.code in (408, 425, 429, 500, 502, 503, 504) and attempt < attempts:
                last_error = error
            else:
                return error.code, payload
        except TRANSIENT_EXCEPTIONS as error:  # noqa: PERF203 - retry is the point
            if attempt >= attempts:
                raise
            last_error = error
        time.sleep(RETRY_BACKOFF_SECONDS[min(attempt - 1, len(RETRY_BACKOFF_SECONDS) - 1)])
        print(
            f"retry {attempt + 1}/{attempts} after {type(last_error).__name__}: {last_error}",
            file=sys.stderr,
        )
    raise RuntimeError(f"{method} {url.split('?')[0]} failed after {attempts} attempts: {last_error}")


def main() -> None:
    dev_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("template", choices=["launch", "session", "session_1h"])
    parser.add_argument("--session-line", required=True,
                        help='e.g. "September 5, 3:00-4:30 pm Eastern, with Dr. Martyn Rawson"')
    parser.add_argument("--session-slug", required=True,
                        help='session slug used to limit delivery to entitled participants')
    parser.add_argument("--send-test", metavar="EMAIL",
                        help="send one real email (first enrollee's content) to this address")
    parser.add_argument("--apply", action="store_true", help="send to the full active roster")
    parser.add_argument("--confirm-template", help="must repeat the template name when using --apply")
    parser.add_argument("--skip-sent-within-hours", type=float, default=6.0,
                        help="with --apply, skip anyone already sent this message type in the last "
                             "N hours, so a run that died mid-roster can be re-run without "
                             "double-sending. 0 disables the guard.")
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

    course = rest(f"cfa_learn_courses?slug=eq.{COURSE_SLUG}&select=id,program_id")[0]
    program_id = course["program_id"]
    session_rows = rest(
        f"cfa_learn_sessions?course_id=eq.{course['id']}&slug=eq.{args.session_slug}"
        "&published=is.true&select=id,slug"
    )
    if not session_rows:
        raise RuntimeError(f"Published session {args.session_slug!r} not found")
    session_id = session_rows[0]["id"]
    enrollments = rest(
        f"enrollments?client_id=eq.{CFA_CLIENT_ID}&program_id=eq.{program_id}"
        "&status=eq.registered&revoked_at=is.null"
        "&select=id,contact_id,access_scope,access_starts_at,access_ends_at&order=enrolled_at"
    )
    now = datetime.now(timezone.utc)

    def active(enrollment: dict[str, Any]) -> bool:
        starts = datetime.fromisoformat(enrollment["access_starts_at"].replace("Z", "+00:00"))
        ends_value = enrollment.get("access_ends_at")
        ends = datetime.fromisoformat(ends_value.replace("Z", "+00:00")) if ends_value else None
        return starts <= now and (ends is None or ends > now)

    enrollments = [e for e in enrollments if active(e)]
    restricted_ids = [e["id"] for e in enrollments if e.get("access_scope") == "sessions"]
    entitled_restricted = set()
    if restricted_ids:
        joined = ",".join(restricted_ids)
        entitled_restricted = {
            row["enrollment_id"]
            for row in rest(
                f"enrollment_session_access?enrollment_id=in.({joined})&session_id=eq.{session_id}"
                "&select=enrollment_id"
            )
        }
    enrollments = [
        e for e in enrollments
        if e.get("access_scope") == "all" or e["id"] in entitled_restricted
    ]
    contact_ids = ",".join(sorted({e["contact_id"] for e in enrollments}))
    contacts = ({
        c["id"]: c
        for c in rest(f"contacts?client_id=eq.{CFA_CLIENT_ID}&id=in.({contact_ids})&select=id,email,first_name,last_name")
    } if contact_ids else {})
    roster = [
        {
            "enrollment_id": e["id"],
            "email": contacts[e["contact_id"]]["email"],
            "name": f'{contacts[e["contact_id"]].get("first_name") or ""} {contacts[e["contact_id"]].get("last_name") or ""}'.strip(),
        }
        for e in enrollments
        if e["contact_id"] in contacts
        and contacts[e["contact_id"]]["email"].strip().lower()
        not in NOTIFICATION_EXCLUDED_EMAILS
    ]
    if args.template == "session_1h":
        roster_emails = {row["email"].strip().lower() for row in roster}
        missing_required = sorted(REQUIRED_ONE_HOUR_RECIPIENTS - roster_emails)
        if missing_required:
            raise RuntimeError(
                "required one-hour recipients are not active and entitled: "
                + ", ".join(missing_required)
            )

    def send(enrollment_id: str, override: str | None = None) -> tuple[int, Any]:
        body: dict[str, Any] = {
            "enrollment_id": enrollment_id,
            "template": args.template,
            "session_line": args.session_line,
            "session_slug": args.session_slug,
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
        # Prefer the test recipient's own enrollment so the durable link in the
        # test email belongs to them, never to a real participant.
        test_email = args.send_test.strip().lower()
        own = next((r for r in roster if r["email"].lower() == test_email), None)
        if own is None:
            raise RuntimeError(
                f"{test_email} has no active enrollment; test emails must not carry another person's link"
            )
        status, result = send(own["enrollment_id"], override=args.send_test)
        print(json.dumps({"mode": "test_send", "to": args.send_test, "status": status, "result": result}, indent=2))
        return

    if not args.apply:
        print(json.dumps({
            "mode": "dry_run",
            "template": args.template,
            "session_line": args.session_line,
            "session_slug": args.session_slug,
            "recipients": len(roster),
            "sample": [r["email"] for r in roster[:5]],
        }, indent=2))
        return

    if args.confirm_template != args.template:
        raise RuntimeError("--apply requires --confirm-template to repeat the template name")

    # Resume guard. cfa-learn-remind is not idempotent - it sends whatever it is
    # asked to send - so re-running after a partial failure would give the people
    # who already got the email a second copy. Anyone recorded as sent inside the
    # window is skipped, which makes a re-run finish the interrupted roster and
    # nothing more. The window is short enough that Saturday's T-1h send (about
    # 23.5 hours after the Friday T-24h send, same message_type) is never
    # suppressed by it.
    message_type = "welcome" if args.template == "launch" else "session_reminder"
    already_sent: set[str] = set()
    if args.skip_sent_within_hours > 0:
        cutoff = (now - timedelta(hours=args.skip_sent_within_hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
        already_sent = {
            row["enrollment_id"]
            for row in rest(
                f"cfa_learn_email_events?message_type=eq.{message_type}"
                f"&status=eq.sent&sent_at=gte.{cutoff}"
                "&select=enrollment_id&limit=5000"
            )
        }
    pending = [row for row in roster if row["enrollment_id"] not in already_sent]
    skipped = len(roster) - len(pending)

    # One recipient's network failure must not discard everybody after them in the
    # roster; it is recorded as a failure and the loop keeps going, so the summary
    # always names exactly who did not get the email.
    sent, failed = 0, []
    for index, row in enumerate(pending, start=1):
        try:
            status, result = send(row["enrollment_id"])
        except Exception as error:  # noqa: BLE001 - any send failure is one person, not the run
            failed.append({"email": row["email"], "status": None, "error": f"{type(error).__name__}: {error}"})
            print(f"{index}/{len(pending)} {row['email']} FAILED: {error}", file=sys.stderr)
        else:
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
        "skipped_already_sent": skipped,
        "total": len(roster),
    }, indent=2))
    if failed:
        # A partial send is not a healthy run: somebody is missing the Zoom link
        # and the wrapper should page rather than report success.
        sys.exit(3)


if __name__ == "__main__":
    main()
