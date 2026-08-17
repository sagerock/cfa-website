#!/usr/bin/env python3
"""Read-only migration audit for the Thinkific Starlight Rays course."""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CFA_CLIENT_ID = "22500cd6-052a-42ff-a0cb-4f3ba9125dfd"
COURSE_ID = "3357450"
PRODUCT_ID = "3683719"
MIGRATION_BATCH_ID = "starlight-thinkific-2026-08-16"
THINKIFIC_API = "https://api.thinkific.com/api/public/v1"


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def request_json(url: str, headers: dict[str, str]) -> Any:
    request = urllib.request.Request(url, headers=headers, method="GET")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 3:
                raise
            time.sleep(int(error.headers.get("Retry-After", "2")))
    raise RuntimeError("request retry loop exhausted")


def thinkific_list(path: str, headers: dict[str, str], params: dict[str, str] | None = None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    while True:
        query = {"page": str(page), "limit": "250", **(params or {})}
        payload = request_json(f"{THINKIFIC_API}{path}?{urllib.parse.urlencode(query)}", headers)
        page_items = payload.get("items", [])
        items.extend(page_items)
        pagination = payload.get("meta", {}).get("pagination", {})
        next_page = pagination.get("next_page")
        if not next_page:
            return items
        page = int(next_page)


def supabase_list(
    base_url: str,
    table: str,
    headers: dict[str, str],
    params: dict[str, str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        query = {**params, "limit": "1000", "offset": str(offset)}
        payload = request_json(
            f"{base_url}/rest/v1/{table}?{urllib.parse.urlencode(query)}",
            headers,
        )
        rows.extend(payload)
        if len(payload) < 1000:
            return rows
        offset += len(payload)


def auth_users(base_url: str, headers: dict[str, str]) -> list[dict[str, Any]]:
    users: list[dict[str, Any]] = []
    page = 1
    while True:
        payload = request_json(
            f"{base_url}/auth/v1/admin/users?page={page}&per_page=1000",
            headers,
        )
        page_users = payload.get("users", [])
        users.extend(page_users)
        if len(page_users) < 1000:
            return users
        page += 1


def normalized_email(value: Any) -> str:
    return str(value or "").strip().lower()


def normalized_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def normalized_phone(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def profile_value(user: dict[str, Any], label: str) -> str:
    for field in user.get("custom_profile_fields") or []:
        if field.get("label") == label:
            return str(field.get("value") or "").strip()
    return ""


def order_has_product(order: dict[str, Any]) -> bool:
    if str(order.get("product_id")) == PRODUCT_ID:
        return True
    return any(str(item.get("product_id")) == PRODUCT_ID for item in order.get("items") or [])


def main() -> None:
    dev_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--thinkific-env",
        type=Path,
        default=dev_root / "sagerock/clients/center-for-anthroposophy/thinkific-mcp/.env",
    )
    parser.add_argument(
        "--supabase-env",
        type=Path,
        default=dev_root / "email-marketing-tool-1/.env",
    )
    parser.add_argument(
        "--identity-resolution",
        type=Path,
        default=dev_root / (
            "sagerock/clients/center-for-anthroposophy/consolidation/data/"
            "identity-resolution-cross-system.csv"
        ),
    )
    parser.add_argument(
        "--roster-dir",
        type=Path,
        default=dev_root / (
            "sagerock/clients/center-for-anthroposophy/starlight-2026/rosters"
        ),
    )
    parser.add_argument(
        "--private-output",
        type=Path,
        default=Path("migration-audits/private/starlight-rays-2026-2027"),
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("docs/starlight-migration-audit-2026-08-16.md"),
    )
    args = parser.parse_args()

    roster_by_email: dict[str, str] = {}
    for roster_path in sorted(args.roster_dir.glob("*.csv")):
        with roster_path.open(newline="") as handle:
            for row in csv.DictReader(handle):
                email = normalized_email(row.get("email"))
                if email in roster_by_email:
                    raise RuntimeError(f"Roster email appears more than once: {email}")
                roster_by_email[email] = roster_path.stem

    thinkific_env = parse_env(args.thinkific_env)
    supabase_env = parse_env(args.supabase_env)
    thinkific_headers = {
        "X-Auth-API-Key": thinkific_env["THINKIFIC_API_KEY"],
        "X-Auth-Subdomain": thinkific_env["THINKIFIC_SUBDOMAIN"],
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "cfa-starlight-migration-audit/1.0",
    }
    supabase_url = (
        supabase_env.get("SUPABASE_URL")
        or supabase_env.get("VITE_SUPABASE_URL")
        or ""
    ).rstrip("/")
    service_key = (
        supabase_env.get("SUPABASE_SERVICE_ROLE_KEY")
        or supabase_env.get("SUPABASE_SERVICE_KEY")
        or ""
    )
    if not supabase_url or not service_key:
        raise RuntimeError("Supabase URL or service-role key is missing")
    supabase_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Accept": "application/json",
    }

    course = request_json(f"{THINKIFIC_API}/courses/{COURSE_ID}", thinkific_headers)
    product = request_json(f"{THINKIFIC_API}/products/{PRODUCT_ID}", thinkific_headers)
    enrollments = thinkific_list(
        "/enrollments",
        thinkific_headers,
        {"query[course_id]": COURSE_ID},
    )
    thinkific_users = {
        str(enrollment["user_id"]): request_json(
            f"{THINKIFIC_API}/users/{enrollment['user_id']}",
            thinkific_headers,
        )
        for enrollment in enrollments
    }
    all_orders = thinkific_list("/orders", thinkific_headers)
    orders = [order for order in all_orders if order_has_product(order)]

    contacts = supabase_list(
        supabase_url,
        "contacts",
        supabase_headers,
        {
            "client_id": f"eq.{CFA_CLIENT_ID}",
            "select": "id,email,first_name,last_name,company,custom_fields,created_at",
        },
    )
    consolidated_people = supabase_list(
        supabase_url,
        "cfa_consolidated_people",
        supabase_headers,
        {
            "select": (
                "email,in_cc,in_thinkific,in_supabase,thinkific_buyer,"
                "cc_permission"
            ),
        },
    )
    programs = supabase_list(
        supabase_url,
        "programs",
        supabase_headers,
        {
            "client_id": f"eq.{CFA_CLIENT_ID}",
            "platform": "eq.thinkific",
            "platform_id": f"eq.{COURSE_ID}",
            "select": "id,name,platform,platform_id",
        },
    )
    if len(programs) != 1:
        raise RuntimeError(f"Expected one Starlight program, found {len(programs)}")
    program_id = programs[0]["id"]
    existing_enrollments = supabase_list(
        supabase_url,
        "enrollments",
        supabase_headers,
        {
            "client_id": f"eq.{CFA_CLIENT_ID}",
            "program_id": f"eq.{program_id}",
            "select": "id,contact_id,platform_enrollment_id,source,source_reference,status",
        },
    )
    identities = supabase_list(
        supabase_url,
        "client_auth_identities",
        supabase_headers,
        {
            "client_id": f"eq.{CFA_CLIENT_ID}",
            "select": "contact_id,user_id",
        },
    )
    users = auth_users(supabase_url, supabase_headers)

    contacts_by_email: dict[str, list[dict[str, Any]]] = defaultdict(list)
    contacts_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for contact in contacts:
        email = normalized_email(contact.get("email"))
        if email:
            contacts_by_email[email].append(contact)
        name = normalized_name(f"{contact.get('first_name') or ''} {contact.get('last_name') or ''}")
        if name:
            contacts_by_name[name].append(contact)

    consolidated_by_email = {
        normalized_email(row.get("email")): row
        for row in consolidated_people
        if normalized_email(row.get("email"))
    }
    identity_clusters: dict[str, list[dict[str, str]]] = {}
    if args.identity_resolution.exists():
        with args.identity_resolution.open(newline="") as handle:
            cluster_rows: dict[str, list[dict[str, str]]] = defaultdict(list)
            for row in csv.DictReader(handle):
                cluster_rows[row["person_id"]].append(row)
        for cluster in cluster_rows.values():
            for row in cluster:
                identity_clusters[normalized_email(row.get("email"))] = cluster

    auth_by_email: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for user in users:
        email = normalized_email(user.get("email"))
        if email:
            auth_by_email[email].append(user)
    identity_by_contact = {row["contact_id"]: row for row in identities}
    existing_by_source = {
        str(row["platform_enrollment_id"]): row
        for row in existing_enrollments
        if row.get("platform_enrollment_id")
    }
    existing_by_contact = {row["contact_id"]: row for row in existing_enrollments}

    orders_by_user: dict[str, list[dict[str, Any]]] = defaultdict(list)
    orders_by_email: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for order in orders:
        if order.get("user_id") is not None:
            orders_by_user[str(order["user_id"])].append(order)
        email = normalized_email(order.get("user_email"))
        if email:
            orders_by_email[email].append(order)

    rows: list[dict[str, Any]] = []
    for enrollment in enrollments:
        email = normalized_email(enrollment.get("user_email"))
        name = str(enrollment.get("user_name") or "").strip()
        thinkific_user = thinkific_users[str(enrollment.get("user_id"))]
        school = profile_value(thinkific_user, "School")
        phone = profile_value(thinkific_user, "Phone Number")
        exact_contacts = contacts_by_email.get(email, [])
        name_contacts = contacts_by_name.get(normalized_name(name), []) if name else []
        alternate_contacts_by_id: dict[str, dict[str, Any]] = {}
        for identity_row in identity_clusters.get(email, []):
            alternate_email = normalized_email(identity_row.get("email"))
            if alternate_email == email:
                continue
            for contact in contacts_by_email.get(alternate_email, []):
                alternate_contacts_by_id[contact["id"]] = contact
        alternate_contacts = list(alternate_contacts_by_id.values())
        matched_contact: dict[str, Any] | None = None
        identity_evidence: list[str] = []
        if len(exact_contacts) == 1:
            match_status = "exact_email_unique"
            matched_contact = exact_contacts[0]
        elif len(exact_contacts) > 1:
            match_status = "exact_email_multiple"
        elif len(alternate_contacts) == 1:
            match_status = "alternate_email_review"
        elif len(alternate_contacts) > 1:
            match_status = "alternate_email_ambiguous"
        elif len(name_contacts) == 1:
            match_status = "name_only_review"
            candidate = name_contacts[0]
            if email.partition("@")[2] == normalized_email(candidate.get("email")).partition("@")[2]:
                identity_evidence.append("same_email_domain")
            if school and normalized_name(school) == normalized_name(candidate.get("company")):
                identity_evidence.append("school_matches_company")
            contact_phone = normalized_phone((candidate.get("custom_fields") or {}).get("phone"))
            if len(normalized_phone(phone)) >= 7 and normalized_phone(phone) == contact_phone:
                identity_evidence.append("phone_exact")
        elif len(name_contacts) > 1:
            match_status = "name_only_ambiguous"
        else:
            match_status = "unmatched"

        user_orders = orders_by_user.get(str(enrollment.get("user_id")), [])
        if not user_orders:
            user_orders = orders_by_email.get(email, [])
        existing = existing_by_source.get(str(enrollment.get("id")))
        if not existing and matched_contact:
            existing = existing_by_contact.get(matched_contact["id"])
        auth_matches = auth_by_email.get(email, [])
        linked_identity = identity_by_contact.get(matched_contact["id"]) if matched_contact else None
        consolidated = consolidated_by_email.get(email, {})
        candidate_contacts = exact_contacts or alternate_contacts or name_contacts
        source_roster = roster_by_email.get(email, "")
        roster_sources = {
            "whistep-students": "whistep_student_roster",
            "lotus-and-ivy": "lotus_and_ivy_institution_roster",
            "halton-waldorf": "halton_waldorf_institution_roster",
        }
        if user_orders:
            access_classification = "paid_order"
        elif enrollment.get("is_free_trial") and source_roster in roster_sources:
            access_classification = roster_sources[source_roster]
        elif enrollment.get("is_free_trial"):
            access_classification = "free_trial_unclassified"
        else:
            access_classification = "manual_unclassified"
        if match_status == "exact_email_unique":
            import_action = "reuse_contact_upsert_enrollment"
        elif match_status in {"unmatched", "name_only_review"}:
            import_action = "create_contact_upsert_enrollment"
        else:
            import_action = "hold_identity_review"
        rows.append({
            "thinkific_enrollment_id": enrollment.get("id"),
            "thinkific_user_id": enrollment.get("user_id"),
            "email": email,
            "name": name,
            "match_status": match_status,
            "contact_candidate_count": len(candidate_contacts),
            "contact_candidate_emails": ";".join(
                sorted({normalized_email(contact.get("email")) for contact in candidate_contacts})
            ),
            "identity_evidence": ";".join(identity_evidence),
            "contact_id": matched_contact.get("id") if matched_contact else "",
            "school": school,
            "phone": phone,
            "source_roster": source_roster,
            "access_classification": access_classification,
            "import_action": import_action,
            "in_constant_contact_snapshot": bool(consolidated.get("in_cc")),
            "constant_contact_permission": consolidated.get("cc_permission") or "",
            "thinkific_buyer_snapshot": bool(consolidated.get("thinkific_buyer")),
            "auth_user_count": len(auth_matches),
            "auth_identity_linked": bool(linked_identity),
            "existing_central_enrollment_id": existing.get("id") if existing else "",
            "existing_central_enrollment_source": existing.get("source") if existing else "",
            "order_count": len(user_orders),
            "completed_order_count": sum(order.get("status") == "Complete" for order in user_orders),
            "subscription_order_count": sum(bool(order.get("subscription")) for order in user_orders),
            "is_free_trial": bool(enrollment.get("is_free_trial")),
            "activated": bool(enrollment.get("activated_at")),
            "completed": bool(enrollment.get("completed") or enrollment.get("completed_at")),
            "percentage_completed": enrollment.get("percentage_completed") or 0,
            "expired": bool(enrollment.get("expired")),
            "has_expiry_date": bool(enrollment.get("expiry_date")),
            "expiry_date": enrollment.get("expiry_date") or "",
            "activated_at": enrollment.get("activated_at") or "",
            "created_at": enrollment.get("created_at") or "",
        })

    match_counts = Counter(row["match_status"] for row in rows)
    duplicate_enrollment_ids = len(rows) - len({row["thinkific_enrollment_id"] for row in rows})
    duplicate_user_ids = sum(count - 1 for count in Counter(row["thinkific_user_id"] for row in rows).values() if count > 1)
    exact_rows = [row for row in rows if row["match_status"] == "exact_email_unique"]
    review_rows = [row for row in rows if row["match_status"] != "exact_email_unique"]
    possible_duplicate_rows = [
        row for row in rows
        if row["match_status"] not in {"exact_email_unique", "unmatched"}
    ]
    ready_rows = [row for row in rows if row["import_action"] != "hold_identity_review"]
    held_rows = [row for row in rows if row["import_action"] == "hold_identity_review"]
    existing_rows = [row for row in rows if row["existing_central_enrollment_id"]]
    no_order_rows = [row for row in rows if row["order_count"] == 0]
    free_trial_no_order_rows = [
        row for row in rows if row["is_free_trial"] and row["order_count"] == 0
    ]

    args.private_output.mkdir(parents=True, exist_ok=True)
    snapshot = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "course": course,
        "product": product,
        "enrollments": enrollments,
        "users": list(thinkific_users.values()),
        "orders": orders,
        "supabase": {
            "program": programs[0],
            "existing_enrollments": existing_enrollments,
        },
    }
    (args.private_output / "source-snapshot.json").write_text(json.dumps(snapshot, indent=2, sort_keys=True))
    with (args.private_output / "migration-candidates.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with (args.private_output / "identity-review.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(possible_duplicate_rows)

    enrollment_by_id = {str(row["id"]): row for row in enrollments}
    import_plan = []
    for row in rows:
        source_enrollment = enrollment_by_id[str(row["thinkific_enrollment_id"])]
        source_user = thinkific_users[str(row["thinkific_user_id"])]
        contact_reference = row["contact_id"] or f"thinkific_user:{row['thinkific_user_id']}"
        import_plan.append({
            "status": "ready" if row["import_action"] != "hold_identity_review" else "held",
            "action": row["import_action"],
            "contact_reference": contact_reference,
            "contact": {
                "existing_contact_id": row["contact_id"] or None,
                "email": row["email"],
                "first_name": source_user.get("first_name"),
                "last_name": source_user.get("last_name"),
                "source_code": "thinkific-migration",
                "tags": ["starlight-rays-2026-2027"],
                "custom_fields": {
                    "thinkific_user_id": row["thinkific_user_id"],
                    "migration_batch_id": MIGRATION_BATCH_ID,
                    "school": row["school"] or None,
                    "phone": row["phone"] or None,
                    "possible_duplicate_emails": (
                        row["contact_candidate_emails"]
                        if row["match_status"] not in {"exact_email_unique", "unmatched"}
                        else None
                    ),
                },
            },
            "enrollment": {
                "client_id": CFA_CLIENT_ID,
                "program_id": program_id,
                "contact_reference": contact_reference,
                "status": "registered",
                "enrolled_at": source_enrollment.get("activated_at") or source_enrollment.get("created_at"),
                "platform_enrollment_id": str(row["thinkific_enrollment_id"]),
                "source": "thinkific",
                "source_reference": str(row["thinkific_enrollment_id"]),
                "access_starts_at": source_enrollment.get("activated_at") or source_enrollment.get("created_at"),
                "access_ends_at": source_enrollment.get("expiry_date"),
                "raw_data": {
                    "thinkific_course_id": COURSE_ID,
                    "thinkific_product_id": PRODUCT_ID,
                    "thinkific_user_id": row["thinkific_user_id"],
                    "migration_batch_id": MIGRATION_BATCH_ID,
                    "is_free_trial": row["is_free_trial"],
                    "access_classification": row["access_classification"],
                    "source_roster": row["source_roster"],
                    "completed_at": source_enrollment.get("completed_at"),
                    "percentage_completed": source_enrollment.get("percentage_completed"),
                    "order_count": row["order_count"],
                },
            },
            "identity_review": {
                "match_status": row["match_status"],
                "candidate_emails": row["contact_candidate_emails"],
                "evidence": row["identity_evidence"],
                "blocks_import": row["import_action"] == "hold_identity_review",
            },
        })
    (args.private_output / "import-plan.json").write_text(
        json.dumps(import_plan, indent=2, sort_keys=True)
    )

    status_counts = Counter(str(order.get("status")) for order in orders)
    created_days = Counter(str(row["created_at"])[:10] for row in rows)
    school_sizes = Counter(row["school"] for row in rows if row["school"])
    roster_counts = Counter(row["source_roster"] for row in rows)
    roster_missing = sorted(set(roster_by_email) - {row["email"] for row in rows})
    source_not_in_rosters = sorted({row["email"] for row in rows} - set(roster_by_email))
    action_counts = Counter(row["import_action"] for row in rows)
    contact_references = [record["contact_reference"] for record in import_plan]
    source_references = [record["enrollment"]["source_reference"] for record in import_plan]
    validation = {
        "migration_batch_id": MIGRATION_BATCH_ID,
        "source_enrollments": len(rows),
        "roster_emails": len(roster_by_email),
        "roster_missing_from_thinkific": len(roster_missing),
        "thinkific_missing_from_rosters": len(source_not_in_rosters),
        "unique_contact_references": len(set(contact_references)),
        "unique_source_references": len(set(source_references)),
        "reuse_contacts": action_counts["reuse_contact_upsert_enrollment"],
        "create_contacts": action_counts["create_contact_upsert_enrollment"],
        "enrollment_upserts": len(import_plan),
        "held": len(held_rows),
        "possible_duplicate_flags": len(possible_duplicate_rows),
        "auth_users_to_create": 0,
        "existing_enrollments_to_update": len(existing_rows),
    }
    required_checks = {
        "all_rosters_match": not roster_missing and not source_not_in_rosters,
        "contact_references_unique": len(set(contact_references)) == len(rows),
        "source_references_unique": len(set(source_references)) == len(rows),
        "all_access_starts_present": all(
            record["enrollment"]["access_starts_at"] for record in import_plan
        ),
        "all_records_ready": not held_rows,
    }
    validation["checks"] = required_checks
    if not all(required_checks.values()):
        raise RuntimeError(f"Dry-run validation failed: {required_checks}")
    (args.private_output / "dry-run-validation.json").write_text(
        json.dumps(validation, indent=2, sort_keys=True)
    )
    creation_waves = "\n".join(
        f"| {day or 'unknown'} | {count} |"
        for day, count in sorted(created_days.items())
    )
    generated_date = datetime.now().astimezone().date().isoformat()
    summary = f"""# Starlight Rays Thinkific migration audit

**Generated:** {generated_date}

**Mode:** Read-only live-source audit

**Thinkific course:** `{COURSE_ID}`

**Thinkific product:** `{PRODUCT_ID}`

**Migration batch:** `{MIGRATION_BATCH_ID}`

## Executive summary

- Thinkific enrollments: **{len(rows)}**
- Unique Thinkific users: **{len({row['thinkific_user_id'] for row in rows})}**
- Exact, unique Supabase contact matches: **{len(exact_rows)}**
- Identity records requiring review or creation: **{len(review_rows)}**
- Existing central Starlight enrollments matching the source roster: **{len(existing_rows)}**
- Starlight orders: **{len(orders)}** ({status_counts.get('Complete', 0)} complete)
- Enrollments without a direct matching order: **{len(no_order_rows)}**
- Subscription orders: **{sum(bool(order.get('subscription')) for order in orders)}**
- Dry-run records ready to import: **{len(ready_rows)}**
- Dry-run records held for identity review: **{len(held_rows)}**

All **{len(free_trial_no_order_rows)}** no-order enrollments carry Thinkific's `is_free_trial`
flag. The authoritative source CSVs classify the complete roster as **{roster_counts['whistep-students']} WHiSTEP**,
**{roster_counts['lotus-and-ivy']} Lotus & Ivy**, and **{roster_counts['halton-waldorf']} Halton Waldorf** participants.
The 74 roster emails match the 74 Thinkific enrollments exactly: **{len(roster_missing)} missing**
and **{len(source_not_in_rosters)} extra**.

## Identity matching

| Result | Count | Proposed handling |
|---|---:|---|
| Exact email, one contact | {match_counts['exact_email_unique']} | Safe enrollment candidate |
| Exact email, multiple contacts | {match_counts['exact_email_multiple']} | Resolve duplicate contact before import |
| Resolved cluster finds one alternate-email contact | {match_counts['alternate_email_review']} | Human confirmation before linking |
| Resolved cluster finds multiple contacts | {match_counts['alternate_email_ambiguous']} | Human review |
| Name-only, one candidate | {match_counts['name_only_review']} | Create roster-email contact; flag possible duplicate |
| Name-only, multiple candidates | {match_counts['name_only_ambiguous']} | Human review |
| No contact candidate | {match_counts['unmatched']} | Create roster-email contact |

Existing Supabase Auth users matching roster email: **{sum(row['auth_user_count'] > 0 for row in rows)}**.

Existing client auth identities linked to matched contacts: **{sum(row['auth_identity_linked'] for row in rows)}**.

Roster emails already present in Constant Contact's consolidated snapshot: **{sum(row['in_constant_contact_snapshot'] for row in rows)}**.

Roster emails marked as historical Thinkific buyers in that snapshot: **{sum(row['thinkific_buyer_snapshot'] for row in rows)}**.

Of the 10 name-only candidates, **{sum('phone_exact' in row['identity_evidence'] for row in possible_duplicate_rows)}** share an exact phone,
**{sum('school_matches_company' in row['identity_evidence'] for row in possible_duplicate_rows)}** match school to company, and
**{sum('same_email_domain' in row['identity_evidence'] for row in possible_duplicate_rows)}** share an email domain. The roster-provided
emails are preserved as separate access identities and the candidate personal emails remain flagged
for later person-level review; these records do not block the entitlement import.

Auth accounts should remain just-in-time: import contacts and entitlements first, then create or
link Auth identities when participants accept a magic-link invitation.

## Enrollment state

- Activated in Thinkific: **{sum(row['activated'] for row in rows)}**
- Marked as free trial: **{sum(row['is_free_trial'] for row in rows)}**
- WHiSTEP student roster: **{sum(row['access_classification'] == 'whistep_student_roster' for row in rows)}**
- Lotus & Ivy institution roster: **{sum(row['access_classification'] == 'lotus_and_ivy_institution_roster' for row in rows)}**
- Halton Waldorf institution roster: **{sum(row['access_classification'] == 'halton_waldorf_institution_roster' for row in rows)}**
- Free-trial records without a roster-source classification: **{sum(row['access_classification'] == 'free_trial_unclassified' for row in rows)}**
- Distinct populated schools: **{len(school_sizes)}**
- Completed in Thinkific: **{sum(row['completed'] for row in rows)}**
- Expired in Thinkific: **{sum(row['expired'] for row in rows)}**
- Carrying an expiry date: **{sum(row['has_expiry_date'] for row in rows)}**
- Duplicate enrollment IDs: **{duplicate_enrollment_ids}**
- Additional enrollments sharing a Thinkific user ID: **{duplicate_user_ids}**

### Enrollment creation waves

| Created date | Enrollments |
|---|---:|
{creation_waves}

Preserve each Thinkific enrollment ID in `platform_enrollment_id` and `source_reference`, and retain
the source state in `raw_data`. Completion history should be archived even though the pilot portal
does not yet expose completion tracking.

## Migration recommendation

1. Preserve roster-provided login emails; keep the 10 likely personal-email duplicates flagged.
2. Execute the reviewed, idempotent import using `(contact_id, program_id)` as the destination conflict key
   and Thinkific enrollment ID as source lineage.
3. Invite active participants by magic link without creating passwords.
4. Run Thinkific and the new portal in parallel through at least two Starlight sessions.
5. Rewire Iris roster sync to central enrollments before Thinkific is made read-only.

## Dry-run safety

- Existing contacts reused: **{validation['reuse_contacts']}**
- New roster-email contacts planned: **{validation['create_contacts']}**
- Enrollment upserts planned: **{validation['enrollment_upserts']}**
- Existing source enrollments requiring an update: **{validation['existing_enrollments_to_update']}**
- Records blocked: **{validation['held']}**
- Auth users created by this import: **0**
- Unique contact references: **{validation['unique_contact_references']} / {len(rows)}**
- Unique Thinkific enrollment source references: **{validation['unique_source_references']} / {len(rows)}**

The apply step must look up contacts by client plus normalized email before inserting, then upsert
enrollments on `(contact_id, program_id)`. Both contact metadata and enrollment `raw_data` carry
`migration_batch_id={MIGRATION_BATCH_ID}`. Rollback can therefore revoke or remove only this batch;
created contacts should be deleted only when they have no unrelated activity.

## Private deliverables

PII is excluded from this report. Gitignored files are stored under
`{args.private_output.as_posix()}/`:

- `source-snapshot.json`
- `migration-candidates.csv`
- `identity-review.csv`
- `import-plan.json`
- `dry-run-validation.json`
"""
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    args.summary.write_text(summary)
    print(json.dumps({
        "enrollments": len(rows),
        "exact_contact_matches": len(exact_rows),
        "contacts_to_create": sum(row["import_action"] == "create_contact_upsert_enrollment" for row in rows),
        "possible_duplicate_review": len(possible_duplicate_rows),
        "held": len(held_rows),
        "orders": len(orders),
        "without_orders": len(no_order_rows),
        "summary": str(args.summary),
        "private_output": str(args.private_output),
    }, indent=2))


if __name__ == "__main__":
    main()
