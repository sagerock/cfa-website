#!/usr/bin/env python3
"""Daily mirror of the two live Explorations rosters from Thinkific into learn.*.

Until students move off Thinkific, Thinkific stays the roster of record:
new enrollments, payment-plan expiry dates and extensions are copied in by
the same batch RPC import-thinkific-course.py uses (read-only on Thinkific).

Someone removed from Thinkific is only REPORTED, never revoked here: taking
access away is a decision for a person. Prints one JSON summary; no names
or emails beyond the ones that need a decision.

Usage: explorations-roster-sync.py [--apply]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

COURSES = {3399825: "Explorations Fall 2026-2027", 3270516: "Explorations Spring 2026-2027"}

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("importer", HERE / "import-thinkific-course.py")
importer_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer_module)


def main() -> None:
    dev_root = HERE.parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    importer = importer_module.Importer(
        dev_root / "sagerock/clients/center-for-anthroposophy/thinkific-mcp/.env",
        dev_root / "email-marketing-tool-1/.env",
    )
    by_id = {c["id"]: c for c in importer.courses()}
    report = {"mode": "applied" if args.apply else "dry_run", "courses": []}
    for course_id, label in COURSES.items():
        course = by_id.get(course_id)
        if not course:
            report["courses"].append({"course": label, "error": "course not found on Thinkific"})
            continue
        summary = importer.import_course(course, args.apply)
        live_ids = {row["platform_enrollment_id"] for row in importer.build_rows(course_id, "check")}
        program = importer.ensure_program(course, apply=False)
        ours = importer.rest(
            f"enrollments?program_id=eq.{program['id']}&source=eq.thinkific&revoked_at=is.null"
            "&select=platform_enrollment_id,contact_id"
        ) if program else []
        gone = [r for r in ours if r["platform_enrollment_id"] not in live_ids]
        emails = {}
        if gone:
            ids = ",".join(r["contact_id"] for r in gone)
            emails = {c["id"]: c["email"] for c in importer.rest(f"contacts?id=in.({ids})&select=id,email")}
        report["courses"].append({
            "course": label,
            "thinkific_rows": summary.get("rows"),
            "result": summary.get("result"),
            "removed_on_thinkific_still_active_here": [
                emails.get(r["contact_id"]) for r in gone
            ],
        })
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
