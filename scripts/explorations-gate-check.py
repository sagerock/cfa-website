#!/usr/bin/env python3
"""Headless checks for the Explorations courses on learn.* (and the course list).

1. The internal staff account (enrolled in both cohorts, source=manual) sees
   every course it holds in cfa-learn-courses, can load each Explorations
   course, and can mint playback tokens for its newest recording. While the
   courses are unpublished this exercises the staff-preview path.
2. A throwaway non-staff account sees no courses, and an Explorations course
   is not found for it while unpublished (or denied once published).
3. Anonymous requests are refused.

Prints only statuses, error codes and counts. Never prints tokens or links.
The throwaway auth user is deleted before exit.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gate", HERE / "starlight-gate-check.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

STAFF_EMAIL = "sage@sagerock.com"
OUTSIDER_EMAIL = "explorations-gate2-check@mailinator.com"
SLUGS = ["explorations-online-fall-2026-2027", "explorations-online-spring-2026-2027"]


def main() -> None:
    env = gate.parse_env(Path(__file__).resolve().parents[2] / "email-marketing-tool-1/.env")
    url = (env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or "").rstrip("/")
    service = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_KEY") or ""
    anon = env.get("SUPABASE_ANON_KEY") or env.get("VITE_SUPABASE_ANON_KEY") or ""
    admin_h = {"apikey": service, "Authorization": f"Bearer {service}", "Content-Type": "application/json"}
    anon_h = {"apikey": anon, "Content-Type": "application/json"}

    def sign_in(email: str) -> tuple[str, str]:
        status, link = gate.request_json(f"{url}/auth/v1/admin/generate_link", admin_h, "POST",
                                         {"type": "magiclink", "email": email})
        if status != 200:
            raise RuntimeError(f"generate_link {status}")
        token_hash = link.get("hashed_token") or link.get("properties", {}).get("hashed_token")
        status, session = gate.request_json(f"{url}/auth/v1/verify", anon_h, "POST",
                                            {"type": "magiclink", "token_hash": token_hash})
        if status != 200:
            raise RuntimeError(f"verify {status}")
        return session["access_token"], session["user"]["id"]

    def call(path: str, token: str | None):
        headers = dict(anon_h)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return gate.request_json(f"{url}/functions/v1/{path}", headers)

    token, _ = sign_in(STAFF_EMAIL)
    status, body = call("cfa-learn-courses", token)
    print("staff courses:", status, [(c["slug"], c["published"]) for c in body.get("courses", [])])
    for slug in SLUGS:
        status, body = call(f"cfa-learn-course?slug={slug}", token)
        if status != 200:
            print(slug, status, body.get("error"))
            continue
        sessions = body["sessions"]
        recorded = [s for s in sessions if s["has_recording"]]
        print(slug, status, f"sessions={len(sessions)} recorded={len(recorded)} "
              f"zoom_links={sum(1 for s in sessions if s.get('zoom_url'))} resources={len(body['resources'])}")
        if recorded:
            status, play = call(f"cfa-learn-playback?slug={slug}&session={recorded[-1]['id']}", token)
            print("  playback newest recording:", status, sorted(play.get("tokens", {}).keys()) if status == 200 else play.get("error"))

    status, created = gate.request_json(f"{url}/auth/v1/admin/users", admin_h, "POST",
                                        {"email": OUTSIDER_EMAIL, "email_confirm": True})
    if status == 422 and created.get("error_code") == "email_exists":
        # Left over from an interrupted run: confirm it so the magic link verifies.
        _, link = gate.request_json(f"{url}/auth/v1/admin/generate_link", admin_h, "POST",
                                    {"type": "magiclink", "email": OUTSIDER_EMAIL})
        gate.request_json(f"{url}/auth/v1/admin/users/{link['id']}", admin_h, "PUT", {"email_confirm": True})
    elif status not in (200, 201):
        raise RuntimeError(f"create outsider {status} {created.get('error_code')}")
    outsider_token, outsider_id = sign_in(OUTSIDER_EMAIL)
    try:
        status, body = call("cfa-learn-courses", outsider_token)
        print("outsider courses:", status, len(body.get("courses", [])))
        for slug in SLUGS:
            status, body = call(f"cfa-learn-course?slug={slug}", outsider_token)
            print("outsider", slug, status, body.get("error"))
    finally:
        status, _ = gate.request_json(f"{url}/auth/v1/admin/users/{outsider_id}", admin_h, "DELETE")
        print("outsider deleted:", status)

    status, body = call("cfa-learn-courses", None)
    print("anonymous courses:", status, body.get("error") or body.get("msg") or body.get("message"))


if __name__ == "__main__":
    main()
