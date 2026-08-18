# Starlight Rays learning portal pilot

The `/learn` portal is an authenticated pilot at
`https://learn.centerforanthroposophy.org`. Public marketing content remains static,
while course access comes from Supabase after a participant signs in by email magic link.

## Pilot boundary

- One course: Starlight Rays 2026–2027.
- Live-session pages with private Zoom access.
- Course resources and welcome-letter access.
- Mux-hosted recordings.
- Supabase magic-link authentication and course entitlements.
- Existing CfA email tooling for welcome and reminder messages.
- First-party registration using Authorize.Net Accept.js tokenization.

The pilot does not include quizzes, certificates, discussion forums, roster self-service,
refund tooling, or accounting export.

The Thinkific identity is explicit: this pilot maps to Starlight course `3357450`
and product `3683719`. Thinkific also contains a separate course named “Ignite! Summer
Residency” (course `3075585`, product `3358198`); migrations must use source IDs and
never match either program by name.

## Runtime architecture

```text
Astro on Cloudflare Pages
  -> Authorize.Net AcceptUI.js (hosted card fields and one-time payment nonce)
  -> cfa-register Edge Function (server pricing and charge)
  -> Supabase Auth (magic-link sign-in)
  -> Supabase Postgres (courses, sessions, enrollments, resources)
  -> Supabase Edge Functions (private course payloads and signed URLs)
  -> Mux (adaptive video and signed playback)
  -> CfA email tool (welcome letters and reminders)
```

Git contains templates and public marketing content. Supabase contains operational
course content, including Zoom links. Mux contains videos. The browser receives private
values only after Supabase verifies an active enrollment.

## Minimal data contract

The authenticated course endpoint returns:

```json
{
  "course": {
    "slug": "starlight-rays-2026-2027",
    "title": "Starlight Rays 2026–2027",
    "cohort": "2026-2027 Seminar Series",
    "facilitator": "David Barham, M.Ed."
  },
  "enrollment": {
    "starts_at": "2026-08-15T00:00:00Z",
    "expires_at": null
  },
  "sessions": [
    {
      "id": "methods",
      "presenter": "Dr. Martyn Rawson",
      "title": "...",
      "starts_at": "2026-09-05T19:00:00Z",
      "zoom_url": "returned only to enrolled users",
      "mux_playback_token": null
    }
  ],
  "resources": []
}
```

The database keeps existing CRM contacts separate from login identities:

- `contacts`: existing CfA people records in the email tool.
- `auth.users`: only people who need to sign in.
- `client_auth_identities`: link an auth identity to a client-scoped contact.
- `cfa_learn_courses` and `cfa_learn_sessions`: operational course content.
- `enrollments`: the central client-scoped entitlement granting access.
- `cfa_learn_resources`: private files or links associated with a course/session.
- `cfa_learn_email_events`: welcome/reminder delivery and resend history.
- `program_offers`: server-authoritative price and availability definitions.
- `registrations`: payment state and sanitized gateway results; never card data or nonce.

All `cfa_learn_*` tables require Row Level Security. Zoom URLs and Mux signing keys must
never be exposed through anonymous policies or built into the Astro output.
Authenticated users also have no direct table grants; a verified
Edge Function returns only the learner-safe fields in the contract above.

The original migration in `supabase/migrations/20260815185750_ignite_learning_pilot.sql`
created the prefixed pilot tables. The Starlight registration migration connects those
course records to the shared `contacts`, `programs`, and `enrollments` model, adds the
client-scoped Auth identity bridge, and creates generic offer and registration records.
`cfa-learn-course` is the only learner-facing course data endpoint; it validates the
bearer token and central active enrollment before returning course content.

## Registration and payment

The static form lives at `/register/starlight-rays-2026-2027`. It requests active offers
from `cfa-register`; prices submitted by the browser are ignored. Authorize.Net's hosted
AcceptUI collects card fields and gives the browser a one-time nonce. The Edge Function
uses that nonce for an `authCaptureTransaction`, stores only a masked gateway summary,
creates or links the central CfA contact and Auth identity, creates the central enrollment,
and sends a secure welcome/sign-in link.

Required Edge Function secrets are documented without secret values in `.env.example`.
`REGISTRATION_LIVE` defaults to false. Turnstile was configured and its secret validated for
the production hostname on 2026-08-16. Before production is enabled, CfA must approve the
displayed cancellation language.
Sandbox checkout is not allowed against the shared production database. A one-use production
test authorization instead forces a $1 transaction, immediately voids any nonzero gateway
transaction, and creates no contact, Auth identity, enrollment, or accounting entry.

The first test enrollment links the existing `sage@sagerock.com` Supabase Auth account
to Starlight Rays. The shared project's existing Auth redirect allow-list was preserved and
extended with the learning subdomain, the Pages preview route, and local development.
The shared magic-link template uses Supabase's token-hash callback format and the
allow-listed `RedirectTo`, so each application receives the link at its own Auth route.

## Mux test

Mux's free plan is sufficient for this pilot. After creating the account:

1. Create an environment-scoped access token with Video Read and Write permissions.
   The Mux Data environment key alone cannot upload or manage assets.
2. Store `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` only in the server-side secret store;
   `.env.example` documents the variable names without carrying values.
3. Upload one non-sensitive test recording.
4. Use public playback for interface testing only.
5. Never put a playback ID in `src/data/starlightPilot.js` or other statically built data.
6. Before inviting participants, create the player client-side only after a verified
   Supabase Edge Function returns a short-lived signed playback token. Never render
   the token during Astro's static build.

That flow exists as of 2026-08-18: `cfa-learn-playback` validates the bearer token and
active enrollment exactly like `cfa-learn-course`, then mints one-hour RS256 playback,
thumbnail, and storyboard tokens for the session's `mux_playback_id`. The course endpoint
exposes only a `has_recording` boolean; the playback ID itself never reaches the browser
outside the signed-token response. The Mux access token and signing key live only in the
Supabase secret store (`MUX_*`, private key converted to PKCS8 for Deno's jose import).
The one sample asset keeps its public playback ID for interface testing; real session
recordings get signed playback IDs only.

## Release gates

1. One internal user completes magic-link sign-in and sees only Starlight Rays.
2. A second authenticated account without enrollment receives an access-denied response.
3. One test Zoom link and signed Mux recording work for the enrolled user but not anonymously.
4. The email tool records and resends a welcome message.
5. A controlled $1 production test is voided and creates no learner or accounting records.
6. Sandbox payment testing uses a separate non-production Supabase project.
7. A successful charge followed by an access failure is marked `enrollment_pending` for
   manual reconciliation and is never charged automatically a second time.

## Gate status

Recorded evidence only; a gate with no entry is open. Headless runs use
`scripts/starlight-gate-check.py`, which prints sanitized evidence and removes its
throwaway test account.

- **Gate 1 — partially passed 2026-08-18 (API path).** Magic-link verification for the
  enrolled internal account succeeded and the course endpoint returned only Starlight
  Rays (12 sessions; a different course slug returns 404). Still owed before the gate
  fully closes: one browser walkthrough using a real delivered magic-link email, since
  the headless run generates the link server-side and does not exercise email delivery.
- **Gate 2 — passed 2026-08-18.** A freshly created authenticated account with no
  enrollment received 403 `enrollment_required`; an anonymous request received 401.
  The test account was deleted afterward.
- **Gate 3 — passed 2026-08-18.** Video: with a session temporarily pointed at the signed
  sample asset, the enrolled user received playback/thumbnail/storyboard tokens and the
  HLS stream returned 200 with the token; the stream returned 403 without it; the
  playback endpoint returned 401 anonymously and 403 for an authenticated unenrolled
  account; the course payload reported `has_recording` without exposing the playback ID;
  the session row was restored to null afterward. Zoom: all 12 sessions now carry the
  season's vanity room link (`centerforanthroposophy.org/zoomroom4`, announced by David
  to participants 2026-08-18; it 301s to the real Zoom meeting so CfA can repoint it),
  returned only through the authenticated course endpoint — the same run shows the
  enrolled user receiving it and unenrolled/anonymous callers denied.
- **Gate 4 — passed 2026-08-18.** The `cfa-learn-welcome` Edge Function (guarded by
  the dedicated `CFA_LEARN_OPS_TOKEN` header, no CORS) sends or resends the portal
  welcome for one central enrollment: it ensures the Auth user and the client-scoped
  identity bridge (erroring on any identity conflict rather than re-linking), mints a
  fresh sign-in link, sends via SendGrid, and records every delivery in
  `cfa_learn_email_events` with the provider message id and `resend_of` lineage.
  This is also the unit of the invitation wave. Evidence (`starlight-gate-check.py
  --gate4`, Sage approving the enabling migration): two sends to the internal
  account returned 200, two events recorded with provider ids, the second linking
  `resend_of` to the first; an unauthorized call returned 401; delivery confirmed in
  the recipient inbox. Migration `20260818181500_welcome_email_delivery_log` was
  applied with explicit approval and recorded in the remote migration history.
- **Gate 5 — passed 2026-08-18.** Sage ran the controlled production test in the
  browser with a one-use token (SHA-256-gated, two-hour expiry): the $1 charge was
  approved and immediately voided, the registration row is retained as `is_test` /
  `voided` with its gateway transaction id, and the residue check against the
  pre-test baseline shows zero new contacts, Auth users, identities, or
  enrollments. A first attempt correctly 409'd on the already-enrolled guard
  (the tester's own enrolled email); the passing run used an unenrolled address.
  Test mode was disarmed and the token secret removed immediately afterward.
- **Gate 6 — waived by Sage 2026-08-18** (see `DECISIONS.md`). No sandbox project;
  payment verification rests on gate 5's $1-charge-and-void production test. Failure
  paths remain code-verified only. Sandbox checkout stays disallowed against the
  shared production database.
- **Gate 7 — code-verified 2026-08-18; live exercise folded into gate 5.** Three
  layers prevent a second automatic charge after charge-but-no-access: replaying the
  same idempotency key against an `enrollment_pending` registration returns 409
  before any gateway call; a new attempt for the same email and program 409s while
  any pending record exists; and `registrations_one_active_email_program_idx`
  enforces one active registration per email and program at the database.
