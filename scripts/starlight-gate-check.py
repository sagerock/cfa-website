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
) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, headers=headers, method=method, data=data)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.load(response)
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
        evidence["gate2_unenrolled_user"] = {
            "email": GATE2_EMAIL,
            "magic_link_verified": True,
            "course_status": status2,
            "course_error": payload2.get("error"),
            "anonymous_status": anon_status,
            "anonymous_error": anon_payload.get("error"),
        }
    finally:
        delete_status, _ = request_json(
            f"{supabase_url}/auth/v1/admin/users/{user_id}",
            admin_headers,
            method="DELETE",
        )
        evidence["gate2_cleanup"] = {"test_user_deleted": delete_status in (200, 204)}

    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
