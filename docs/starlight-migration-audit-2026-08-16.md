# Starlight Rays Thinkific migration audit

**Generated:** 2026-08-17

**Mode:** Read-only live-source audit

**Thinkific course:** `3357450`

**Thinkific product:** `3683719`

**Migration batch:** `starlight-thinkific-2026-08-16`

## Executive summary

- Thinkific enrollments: **74**
- Unique Thinkific users: **74**
- Exact, unique Supabase contact matches: **6**
- Identity records requiring review or creation: **68**
- Existing central Starlight enrollments matching the source roster: **0**
- Starlight orders: **4** (4 complete)
- Enrollments without a direct matching order: **70**
- Subscription orders: **0**
- Dry-run records ready to import: **74**
- Dry-run records held for identity review: **0**

All **70** no-order enrollments carry Thinkific's `is_free_trial`
flag. The authoritative source CSVs classify the complete roster as **25 WHiSTEP**,
**23 Lotus & Ivy**, and **26 Halton Waldorf** participants.
The 74 roster emails match the 74 Thinkific enrollments exactly: **0 missing**
and **0 extra**.

## Identity matching

| Result | Count | Proposed handling |
|---|---:|---|
| Exact email, one contact | 6 | Safe enrollment candidate |
| Exact email, multiple contacts | 0 | Resolve duplicate contact before import |
| Resolved cluster finds one alternate-email contact | 0 | Human confirmation before linking |
| Resolved cluster finds multiple contacts | 0 | Human review |
| Name-only, one candidate | 10 | Create roster-email contact; flag possible duplicate |
| Name-only, multiple candidates | 0 | Human review |
| No contact candidate | 58 | Create roster-email contact |

Existing Supabase Auth users matching roster email: **0**.

Existing client auth identities linked to matched contacts: **0**.

Roster emails already present in Constant Contact's consolidated snapshot: **35**.

Roster emails marked as historical Thinkific buyers in that snapshot: **30**.

Of the 10 name-only candidates, **0** share an exact phone,
**0** match school to company, and
**4** share an email domain. The roster-provided
emails are preserved as separate access identities and the candidate personal emails remain flagged
for later person-level review; these records do not block the entitlement import.

Auth accounts should remain just-in-time: import contacts and entitlements first, then create or
link Auth identities when participants accept a magic-link invitation.

## Enrollment state

- Activated in Thinkific: **4**
- Marked as free trial: **70**
- WHiSTEP student roster: **23**
- Lotus & Ivy institution roster: **22**
- Halton Waldorf institution roster: **25**
- Free-trial records without a roster-source classification: **0**
- Distinct populated schools: **18**
- Completed in Thinkific: **0**
- Expired in Thinkific: **0**
- Carrying an expiry date: **0**
- Duplicate enrollment IDs: **0**
- Additional enrollments sharing a Thinkific user ID: **0**

### Enrollment creation waves

| Created date | Enrollments |
|---|---:|
| 2026-02-25 | 1 |
| 2026-03-16 | 1 |
| 2026-07-13 | 1 |
| 2026-07-30 | 24 |
| 2026-08-10 | 22 |
| 2026-08-14 | 25 |

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

- Existing contacts reused: **6**
- New roster-email contacts planned: **68**
- Enrollment upserts planned: **74**
- Existing source enrollments requiring an update: **0**
- Records blocked: **0**
- Auth users created by this import: **0**
- Unique contact references: **74 / 74**
- Unique Thinkific enrollment source references: **74 / 74**

The apply step must look up contacts by client plus normalized email before inserting, then upsert
enrollments on `(contact_id, program_id)`. Both contact metadata and enrollment `raw_data` carry
`migration_batch_id=starlight-thinkific-2026-08-16`. Rollback can therefore revoke or remove only this batch;
created contacts should be deleted only when they have no unrelated activity.

## Private deliverables

PII is excluded from this report. Gitignored files are stored under
`migration-audits/private/starlight-rays-2026-2027/`:

- `source-snapshot.json`
- `migration-candidates.csv`
- `identity-review.csv`
- `import-plan.json`
- `dry-run-validation.json`
