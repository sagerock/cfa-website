#!/usr/bin/env python3
"""Daily mirror of the two live Explorations rosters from Thinkific into learn.*.

Until students move off Thinkific, Thinkific stays the roster of record:
new enrollments and payment-plan expiry dates are copied in by the same batch
RPC import-thinkific-course.py uses. Read-only on Thinkific.

Source (since 2026-11-10, Jax item #3165): Thinkific's GraphQL API, read with
the existing bearer token THINKIFIC_GQL_ACCESS_TOKEN (thinkific-mcp/.env).
The public REST key has answered 401 since the plan moved to Basic (~10/28),
so the REST path in import-thinkific-course.py no longer works. GraphQL
entitlement ids are not the old REST enrollment ids, so students are matched
by email, and an existing row keeps its id and start dates.

Guard rails, none of which remove access:
- Someone gone from Thinkific is only REPORTED, never revoked here: taking
  access away is a decision for a person.
- An expiry date here that is later than Thinkific's (a manual extension or
  end-of-day withdrawal date set here) is never shortened; it is reported.
- A row revoked here, or held by a non-Thinkific source, is left alone and
  reported (the RPC would un-revoke it or abort the whole batch).
- CfA staff and test identities (@centerforanthroposophy.org) are skipped.
- Only new students and changed expiry dates are written.

Prints one JSON summary; no names or emails beyond the ones that need a decision.

Usage: explorations-roster-sync.py [--apply]
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path

# Thinkific course id -> (label, product id). Product ids from GraphQL course.product.
COURSES = {
    3399825: ("Explorations Fall 2026-2027", "3734011"),
    3270516: ("Explorations Spring 2026-2027", "3588315"),
}
STAFF_DOMAIN = "@centerforanthroposophy.org"
GQL_URL = "https://api.thinkific.com/stable/graphql"
ENTITLEMENTS_QUERY = """query RosterEntitlements($id: ID!, $after: String) {
  product(by: {id: $id}) { id name entitlements(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id status createdAt expiryDate user { id email firstName lastName } } } } }"""

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("importer", HERE / "import-thinkific-course.py")
importer_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer_module)


def ts(value: str | None) -> dt.datetime | None:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def entitlements(token: str, product_id: str) -> list[dict]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) cfa-ops/1.0",
    }
    nodes, after = [], None
    while True:
        payload = importer_module.request_json(
            GQL_URL, headers, "POST", {"query": ENTITLEMENTS_QUERY, "variables": {"id": product_id, "after": after}}
        )
        if payload.get("errors") or not (payload.get("data") or {}).get("product"):
            raise RuntimeError(f"thinkific graphql error for product {product_id}: {payload.get('errors')}")
        page = payload["data"]["product"]["entitlements"]
        nodes.extend(page["nodes"])
        if not page["pageInfo"]["hasNextPage"]:
            return nodes
        after = page["pageInfo"]["endCursor"]


def main() -> None:
    dev_root = HERE.parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    thinkific_env = dev_root / "sagerock/clients/center-for-anthroposophy/thinkific-mcp/.env"
    token = importer_module.parse_env(thinkific_env)["THINKIFIC_GQL_ACCESS_TOKEN"]
    importer = importer_module.Importer(thinkific_env, dev_root / "email-marketing-tool-1/.env")
    report = {"mode": "applied" if args.apply else "dry_run", "source": "thinkific-graphql", "courses": []}

    for course_id, (label, product_id) in COURSES.items():
        program = importer.ensure_program({"id": course_id, "name": label}, apply=False)
        if not program:
            report["courses"].append({"course": label, "error": "no learn.* program row for this course"})
            continue
        live: dict[str, dict] = {}
        staff_skipped = 0
        for node in entitlements(token, product_id):
            email = ((node.get("user") or {}).get("email") or "").strip().lower()
            if not email:
                continue
            if email.endswith(STAFF_DOMAIN):
                staff_skipped += 1
                continue
            live[email] = node

        ours = importer.rest(
            f"enrollments?program_id=eq.{program['id']}"
            "&select=id,contact_id,source,platform_enrollment_id,enrolled_at,access_starts_at,access_ends_at,revoked_at"
        )
        emails = {}
        if ours:
            ids = ",".join(r["contact_id"] for r in ours)
            emails = {c["id"]: c["email"].strip().lower() for c in importer.rest(f"contacts?id=in.({ids})&select=id,email")}
        mine = {emails.get(r["contact_id"]): r for r in ours if emails.get(r["contact_id"])}

        batch_id = f"thinkific-gql-{course_id}-{importer_module.TODAY}"
        rows, unchanged = [], 0
        held = {"later_expiry_here": [], "revoked_here": [], "non_thinkific_row": []}
        for email, node in live.items():
            user = node["user"]
            existing = mine.get(email)
            th_end = node.get("expiryDate")
            if existing:
                if existing["source"] not in ("thinkific", "migration"):
                    held["non_thinkific_row"].append(email)
                    continue
                if existing["revoked_at"]:
                    held["revoked_here"].append(email)
                    continue
                here_end = ts(existing["access_ends_at"])
                if ts(th_end) == here_end:
                    unchanged += 1
                    continue
                if here_end and th_end is not None and ts(th_end) < here_end:
                    held["later_expiry_here"].append(email)
                    continue
            rows.append({
                "email": email,
                "first_name": (user.get("firstName") or "").strip() or "Participant",
                "last_name": (user.get("lastName") or "").strip(),
                "thinkific_user_id": str(user.get("id") or ""),
                "school": None,
                "phone": None,
                "possible_duplicate_emails": None,
                "platform_enrollment_id": existing["platform_enrollment_id"] if existing else str(node["id"]),
                "enrolled_at": existing["enrolled_at"] if existing else node.get("createdAt"),
                "access_starts_at": existing["access_starts_at"] if existing else node.get("createdAt"),
                "access_ends_at": th_end,
                "raw_data": {
                    "migration_batch_id": batch_id,
                    "thinkific": {"entitlement_id": str(node["id"]), "status": node.get("status"), "source": "graphql"},
                },
            })

        result = "nothing_to_write"
        if rows:
            result = "dry_run"
            if args.apply:
                result = importer_module.request_json(
                    f"{importer.supabase_url}/rest/v1/rpc/cfa_import_thinkific_enrollment_batch",
                    importer.sh, method="POST",
                    body={
                        "requested_batch_id": batch_id,
                        "requested_client_id": importer_module.CFA_CLIENT_ID,
                        "requested_program_id": program["id"],
                        "requested_rows": rows,
                    },
                )
        gone = [
            email for email, r in mine.items()
            if r["source"] == "thinkific" and not r["revoked_at"] and email not in live
            and not email.endswith(STAFF_DOMAIN)
        ]
        report["courses"].append({
            "course": label,
            "thinkific_entitlements": len(live),
            "staff_skipped": staff_skipped,
            "unchanged": unchanged,
            "to_write": len(rows),
            "new_students": [r["email"] for r in rows if r["email"] not in mine],
            "expiry_changes": [r["email"] for r in rows if r["email"] in mine],
            "result": result,
            "held_not_written": {k: v for k, v in held.items() if v},
            "removed_on_thinkific_still_active_here": gone,
        })
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
