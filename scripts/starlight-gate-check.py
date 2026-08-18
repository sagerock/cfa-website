#!/usr/bin/env python3
"""Headless evidence runs for Starlight release gates 1 and 2.

Gate 1: an enrolled internal user completes magic-link verification and the
course endpoint returns only Starlight Rays.
Gate 2: an authenticated account with no enrollment is denied, and an
anonymous request is denied.

Prints only sanitized evidence (statuses, error codes, counts). Never prints
tokens, sign-in links, Zoom URLs, or secrets. The gate-2 throwaway auth user
is deleted before exit.
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

GATE1_EMAIL = "sage@sagerock.com"
GATE2_EMAIL = "starlight-gate2-check@sagerock.com"
COURSE_SLUG = "starlight-rays-2026-2027"
GATE3_SESSION_SLUG = "methods"
GATE3_TEST_PLAYBACK_ID = "JddlbDD00UcRWVYUzEgEcOI9mpBEEbbxorMqQ8J0200ZWE"  # signed policy, sample asset


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def fetch_status(url: str) -> int:
    request = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def request_json(
    url: str,
    headers: dict[str, str],
    method: str = "GET",
    body: Any | None = None,
) -> tuple[int, Any]:
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
    parser.add_argument(
        "--supabase-env",
        type=Path,
        default=dev_root / "email-marketing-tool-1/.env",
    )
    parser.add_argument(
        "--anon-key-file",
        type=Path,
        help="File holding the public (publishable) client key; falls back to env vars",
    )
    parser.add_argument(
        "--gate4",
        action="store_true",
        help="Also run gate 4: really sends two welcome emails to the internal account",
    )
    parser.add_argument(
        "--ops-token-env",
        type=Path,
        default=Path("/mnt/d/dev/secrets/cfa-learn-ops.env"),
        help="Env file holding CFA_LEARN_OPS_TOKEN (gate 4 only)",
    )
    args = parser.parse_args()

    env = parse_env(args.supabase_env)
    supabase_url = (env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_KEY") or ""
    anon_key = env.get("SUPABASE_ANON_KEY") or env.get("VITE_SUPABASE_ANON_KEY") or ""
    if not anon_key and args.anon_key_file:
        anon_key = args.anon_key_file.read_text().strip()
    if not supabase_url or not service_key or not anon_key:
        raise RuntimeError("Supabase URL, service-role key, or anon key missing from env")

    admin_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    anon_headers = {"apikey": anon_key, "Content-Type": "application/json"}
    course_url = f"{supabase_url}/functions/v1/cfa-learn-course"
    evidence: dict[str, Any] = {}

    def sign_in_via_magic_link(email: str) -> str:
        """Generate and verify a magic link server-side; return an access token."""
        status, link = request_json(
            f"{supabase_url}/auth/v1/admin/generate_link",
            admin_headers,
            method="POST",
            body={"type": "magiclink", "email": email},
        )
        if status != 200:
            raise RuntimeError(f"generate_link for {email} failed: {status} {link.get('msg') or link.get('error_code')}")
        token_hash = link.get("hashed_token") or link.get("properties", {}).get("hashed_token")
        if not token_hash:
            raise RuntimeError("generate_link returned no token hash")
        status, session = request_json(
            f"{supabase_url}/auth/v1/verify",
            anon_headers,
            method="POST",
            body={"type": "magiclink", "token_hash": token_hash},
        )
        if status != 200 or not session.get("access_token"):
            raise RuntimeError(f"magic-link verify for {email} failed: {status}")
        return session["access_token"]

    def call_course(access_token: str | None, slug: str = COURSE_SLUG) -> tuple[int, Any]:
        headers = dict(anon_headers)
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        return request_json(f"{course_url}?slug={slug}", headers)

    def call_playback(access_token: str | None, session_id: str) -> tuple[int, Any]:
        headers = dict(anon_headers)
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        return request_json(
            f"{supabase_url}/functions/v1/cfa-learn-playback?slug={COURSE_SLUG}&session={session_id}",
            headers,
        )

    def rest_get(path: str) -> Any:
        return request_json(f"{supabase_url}/rest/v1/{path}", admin_headers)[1]

    def rest_patch(path: str, body: dict[str, Any]) -> None:
        status, _ = request_json(
            f"{supabase_url}/rest/v1/{path}",
            {**admin_headers, "Prefer": "return=minimal"},
            method="PATCH",
            body=body,
        )
        if status not in (200, 204):
            raise RuntimeError(f"session update failed: {status}")

    # Gate 1: enrolled internal user
    token = sign_in_via_magic_link(GATE1_EMAIL)
    status, payload = call_course(token)
    sessions = payload.get("sessions", []) if status == 200 else []
    evidence["gate1_enrolled_user"] = {
        "email": GATE1_EMAIL,
        "magic_link_verified": True,
        "course_status": status,
        "course_slug": payload.get("course", {}).get("slug") if status == 200 else None,
        "session_count": len(sessions),
        "sessions_carry_zoom_url": bool(sessions) and all(s.get("zoom_url") for s in sessions),
        "other_slug_lookup": call_course(token, slug="ignite-summer-residency")[0],
    }

    # Gate 3 setup: temporarily point one session at the signed sample asset,
    # restoring the exact prior value afterward.
    rows = rest_get(
        f"cfa_learn_sessions?slug=eq.{GATE3_SESSION_SLUG}&select=id,mux_playback_id"
    )
    if len(rows) != 1:
        raise RuntimeError(f"expected one session with slug {GATE3_SESSION_SLUG}")
    gate3_session_id = rows[0]["id"]
    prior_playback_id = rows[0]["mux_playback_id"]
    rest_patch(
        f"cfa_learn_sessions?id=eq.{gate3_session_id}",
        {"mux_playback_id": GATE3_TEST_PLAYBACK_ID},
    )
    try:
        # Gate 2: authenticated but unenrolled, plus anonymous
        status, created = request_json(
            f"{supabase_url}/auth/v1/admin/users",
            admin_headers,
            method="POST",
            body={"email": GATE2_EMAIL, "email_confirm": True},
        )
        if status not in (200, 201):
            raise RuntimeError(f"gate-2 test user creation failed: {status} {created.get('msg')}")
        user_id = created["id"]
        try:
            token2 = sign_in_via_magic_link(GATE2_EMAIL)
            status2, payload2 = call_course(token2)
            anon_status, anon_payload = call_course(None)
            playback_status2, playback_payload2 = call_playback(token2, gate3_session_id)
            evidence["gate2_unenrolled_user"] = {
                "email": GATE2_EMAIL,
                "magic_link_verified": True,
                "course_status": status2,
                "course_error": payload2.get("error"),
                "anonymous_status": anon_status,
                "anonymous_error": anon_payload.get("error"),
                "playback_status": playback_status2,
                "playback_error": playback_payload2.get("error"),
            }
        finally:
            delete_status, _ = request_json(
                f"{supabase_url}/auth/v1/admin/users/{user_id}",
                admin_headers,
                method="DELETE",
            )
            evidence["gate2_cleanup"] = {"test_user_deleted": delete_status in (200, 204)}

        # Gate 3 (video half): signed playback for the enrolled user, denied elsewhere
        pb_status, pb = call_playback(token, gate3_session_id)
        video_token = pb.get("tokens", {}).get("video", "") if pb_status == 200 else ""
        stream_url = f"https://stream.mux.com/{GATE3_TEST_PLAYBACK_ID}.m3u8"
        course_status, course_payload = call_course(token)
        gate3_session = next(
            (s for s in course_payload.get("sessions", []) if s.get("id") == gate3_session_id),
            {},
        ) if course_status == 200 else {}
        evidence["gate3_signed_playback"] = {
            "playback_endpoint_status": pb_status,
            "tokens_issued": sorted(pb.get("tokens", {}).keys()) if pb_status == 200 else [],
            "expires_at": pb.get("expires_at"),
            "hls_with_token_status": fetch_status(f"{stream_url}?token={video_token}") if video_token else None,
            "hls_anonymous_status": fetch_status(stream_url),
            "anonymous_playback_endpoint_status": call_playback(None, gate3_session_id)[0],
            "course_reports_has_recording": gate3_session.get("has_recording"),
            "course_leaks_playback_id": "mux_playback_id" in gate3_session,
        }
    finally:
        rest_patch(
            f"cfa_learn_sessions?id=eq.{gate3_session_id}",
            {"mux_playback_id": prior_playback_id},
        )
        restored = rest_get(
            f"cfa_learn_sessions?id=eq.{gate3_session_id}&select=mux_playback_id"
        )
        evidence["gate3_cleanup"] = {
            "session_playback_id_restored": restored[0]["mux_playback_id"] == prior_playback_id,
        }

    # Gate 4: the welcome email is recorded and resendable (internal account only)
    if args.gate4:
        program_rows = rest_get(
            f"cfa_learn_courses?slug=eq.{COURSE_SLUG}&select=program_id"
        )
        program_id = program_rows[0]["program_id"]
        client_id = rest_get(f"programs?id=eq.{program_id}&select=client_id")[0]["client_id"]
        contact_rows = rest_get(
            f"contacts?client_id=eq.{client_id}&email=eq.{GATE1_EMAIL}&select=id"
        )
        enrollment_rows = rest_get(
            f"enrollments?contact_id=eq.{contact_rows[0]['id']}&program_id=eq.{program_id}"
            "&status=eq.registered&select=id"
        )
        enrollment_id = enrollment_rows[0]["id"]

        ops_token = parse_env(args.ops_token_env).get("CFA_LEARN_OPS_TOKEN", "")
        if not ops_token:
            raise RuntimeError("CFA_LEARN_OPS_TOKEN missing for gate 4")

        def send_welcome() -> tuple[int, Any]:
            return request_json(
                f"{supabase_url}/functions/v1/cfa-learn-welcome",
                {**anon_headers, "X-Cfa-Ops-Token": ops_token},
                method="POST",
                body={"enrollment_id": enrollment_id},
            )

        first_status, first = send_welcome()
        second_status, second = send_welcome()
        events = rest_get(
            f"cfa_learn_email_events?enrollment_id=eq.{enrollment_id}"
            "&message_type=eq.welcome&select=id,status,provider_message_id,resend_of,sent_at"
            "&order=created_at.asc"
        )
        evidence["gate4_welcome_email"] = {
            "recipient": GATE1_EMAIL,
            "first_send_status": first_status,
            "second_send_status": second_status,
            "events_recorded": len(events),
            "all_sent": all(e["status"] == "sent" for e in events),
            "provider_message_ids_present": all(e["provider_message_id"] for e in events),
            "resend_links_to_prior_event": (
                len(events) >= 2 and events[-1]["resend_of"] == events[-2]["id"]
            ),
            "unauthorized_call_status": request_json(
                f"{supabase_url}/functions/v1/cfa-learn-welcome",
                anon_headers,
                method="POST",
                body={"enrollment_id": enrollment_id},
            )[0],
        }

    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
