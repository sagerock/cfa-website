# Certificate automation

Status: **built locally, not deployed** (2026-09-11). Database migration, Edge Function,
private design asset, and administrator token must be released together.

## What the first slice does

- Keeps versioned certificate templates in `cfa_certificate_templates`.
- Keeps completion/attendance evidence separate from issuance in
  `cfa_certificate_eligibility`.
- Generates a deterministic one-page, landscape PDF from the enrollment name, program,
  optional detail line, award date, and certificate number.
- Stores signed design backgrounds and issued PDFs in separate **private** Supabase Storage
  buckets. Neither the artwork nor learner PDFs belongs in this public repository.
- Preserves an immutable eligibility snapshot and SHA-256 digest on every issued certificate.
- Supports revocation without deleting the historical record.
- Provides a staff-only queue at `/dashboard/certificates#<certificate-admin-token>` for
  eligibility review, PDF preview, issuance, and download.

Issuance is deliberately not automatic yet. The seeded `CfA Classic` template has
`auto_issue = false`; staff must mark a learner eligible, preview the output, and confirm
issuance. No certificate email is sent by this slice.

## Relationship to attendance

This is the issuance half of the attendance → certificate flow in `cfa-growth` backlog
items #35 and #40. Today staff can record a reviewed manual completion. When automated
Zoom attendance lands, its course-level recomputation should upsert the same eligibility
row with:

- `basis = 'attendance'`
- immutable raw-report references in `evidence`
- attended and countable session counts
- the computed ratio and review timestamp

The certificate renderer does not infer attendance. It only issues from an explicit,
reviewed, eligible record, so an uncertain Zoom-name match cannot silently become a
credential.

## Private design asset

Milan's SimpleCert reference PDF places the variable recipient/program/date text over a
single static background image. Extract that background outside the public repository and
upload it to the private asset bucket:

```bash
pdfimages -j reference-certificate.pdf /tmp/cfa-certificate-background
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/upload-certificate-background.mjs \
  /tmp/cfa-certificate-background-000.jpg templates/cfa-classic-v1.jpg
```

The background contains CfA's signature artwork. Do not add it to Git, `public/`, logs, or
chat. If the private asset has not been installed, previews use a clearly recognizable
built-in CfA-style fallback rather than failing.

For an offline preview:

```bash
npm run certificate:preview -- \
  --background /private/path/cfa-classic-v1.jpg \
  --name "Sample Participant" \
  --program "Waldorf High School Teacher Education Program" \
  --detail "with a Concentration in Arts & Art History." \
  --date 2026-07-26 \
  --out exports/private/certificate-preview.pdf
```

`exports/private/` is ignored because previews contain learner names.

## Release checklist

1. Review the generated preview against Milan's reference PDF.
2. Apply `20260911143000_certificate_automation.sql` to the linked Supabase project.
3. Upload the extracted background to `cfa-certificate-assets/templates/cfa-classic-v1.jpg`.
4. Set a new, dedicated `CERTIFICATE_ADMIN_TOKENS` Edge Function secret. Do not reuse or
   expose the broader dashboard viewer tokens; certificate access can write credential
   records.
5. Deploy `cfa-certificates` with JWT verification disabled; the function performs its own
   dedicated token check and keeps all tables/buckets service-role-only.
6. Deploy the Astro build and verify the staff queue from an allowed origin.
7. Preview a test enrollment. Confirm the private background was used via the response
   header (`X-CfA-Fallback-Background: false`).
8. Mark only a test enrollment eligible, issue once, download, verify the PDF hash, then
   revoke the test record with a reason.
9. Have Milan approve the template and wording before any real learner certificate is
   issued. Decide separately whether and how issued certificates are delivered.

## Security boundaries

- Certificate admin access uses `CERTIFICATE_ADMIN_TOKENS`, not `DASHBOARD_TOKENS`.
- Tables and buckets have RLS enabled and no browser role grants.
- A certificate cannot be issued without a reviewed eligibility record.
- A second active certificate for the same enrollment/template is rejected.
- Preview does not write, issue, or deliver anything.
- Final PDFs are private and served only through the authenticated function.
- Revocation is recorded; issued rows are never hard-deleted by the UI.
