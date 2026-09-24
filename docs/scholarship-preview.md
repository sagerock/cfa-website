# Scholarship application preview

First milestone, 2026-09-22. Review route: `/scholarships`.

## What runs

The applicant walkthrough and staff review are a self-contained, fictional-data
preview. The six-digit code `123456` is explicitly a simulation. No email is sent,
no Supabase client is imported, and CSP disallows all network connections from the
page. Progress and the example review history use sessionStorage in the current
browser tab. Closing that tab clears the example. All program names, prices, and
applicants in this page are invented.

The walkthrough covers a program choice, school affiliation, manageable monthly
payments, confirmed outside support, optional household context and circumstances,
and an applicant review before submission. It accepts zero contributions and
shows missing information instead of treating it as zero. The reviewer sees an
arithmetic funding gap and can record an example action with a reason. This is
not a need score, award, budget reservation, or AI-generated recommendation.

The guide currently uses deterministic prompts. AI assistance, document uploads,
applicant notifications, real program data, and real intake are not enabled.

## Staged live foundation

The migration `20260922160000_scholarship_application_foundation.sql` is unapplied.
It adds an empty program catalog (intake defaults closed), reviewer allowlist,
owner-scoped applications, and append-only internal review records. Submission
snapshots the tuition and policy version. Draft saves require an expected revision,
so stale tabs cannot silently overwrite later edits. Submitted applications lock.
Applicant-facing revisions and notification release need an explicit later workflow.

All tables have RLS. Anonymous users have no table access; authenticated users can
read only their applications; authorized reviewers can read submitted applications.
Review notes are internal. Writes go through restricted RPCs, with server-side
validation, reviewer checks, and no self-review. Roles cannot be self-assigned.
Nothing writes to enrollment, payment, accounting, or contact/marketing tables.

`src/lib/scholarships/client.js` is an unconnected live adapter for code requests,
Supabase `verifyOtp`, application retrieval, draft/submission RPCs, and review RPCs.

`cfa-scholarship-signin` is an undeployed closed-pilot Edge Function. It requires:

- `SCHOLARSHIP_PILOT_ENABLED=true`, an exact `SCHOLARSHIP_ORIGIN`, and an explicit
  `SCHOLARSHIP_PILOT_EMAILS` invitation list;
- `SCHOLARSHIP_RATE_SECRET`, Supabase server credentials, and SendGrid credentials;
- the migration's atomic per-email quota (three attempts per 15 minutes).

It generates Supabase email OTPs and sends CfA-branded codes without changing
shared Auth templates. It does not create course entitlements or attach contacts.
No tokens, codes, or recipient email addresses are logged. Supabase verifies code
expiry and single use; confirm the actual project settings in a test pilot.
The public preview cannot invoke this function. Do not remove the invitation list
without adding public-intake abuse protection, including a tested bot challenge.

## Validation

Use Node 22 and the repository's existing dependencies:

```sh
npm run build
node --test tests/scholarships/model.test.mjs
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js \
  node --test tests/scholarships/database.test.mjs
```

The database test uses an isolated PostgreSQL-compatible PGlite instance with
mocked Supabase roles and auth.uid; it never connects to the live database. It
checks cross-user reads, reviewer-only access, protected drafts, optimistic
revisions, submission locking, policy/tuition snapshots, prohibited direct writes,
internal notes, award limits, anonymous denial, and the atomic sign-in quota.
Without `PGLITE_MODULE`, that integration test explicitly skips.

Before live intake: agree actual programs/terms, minimum necessary financial
questions, document requirements and retention, budget/eligibility rubric,
review authority, exception/reconsideration process, and applicant-facing notice.
Test deployed RLS, real OTP delivery/expiry/reuse, session recovery across devices,
concurrent writes, and reviewer access using approved test accounts. The staged
code is a foundation, not evidence that those hosted tests have passed.

## Second pass, 2026-09-23: real programs from the calendar

Milan asked for CfA's actual scholarship programs. Step 1 is now one program menu in
two groups. Professional Development lists Building Bridges, Explorations, Mentor Training,
Renewal, Starlight Rays and Waldorf Leadership Development. Teacher Training lists Antioch
and WHiSTEP. After a program is chosen, the applicant picks dates from `src/data/calendar.js`
(merged in from the `program-calendar` branch). Past runs drop off at page load, and
"a future session or cohort" is always offered. Antioch has no public dates, so it offers
only that. Teacher Training applicants see a pointer to the Waldorf Fellowship and AWSNA
loans and grants on the Tuition Assistance page. Those keep their own forms.

The applicant now enters the program cost from the program page. No tuition is
hard-coded here. Applicant details are still fictional; nothing else changed about what
the preview can do. This branch now carries the calendar commits, so merge
`program-calendar` first or together.
