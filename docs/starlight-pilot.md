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
- Session-scoped access for the three featured single-session products and bundle.

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
      "entitled": true,
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
- `program_offer_sessions`: sessions included by a session-scoped offer.
- `enrollment_session_access`: the purchased session entitlements snapshotted onto an enrollment.
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

## Payment plans

Added 2026-09-02 at Sage's direction for the individual offer only (`individual-plan`,
five monthly installments, same $420 total, no surcharge). A plan offer is a
`program_offers` row with `installment_count > 1`; `amount_cents` is still the full price
and `cfa-register` splits it evenly with the remainder on the first installment. Coupons
apply to the total before the split.

Mechanism (chosen over a pure ARB subscription so that "paid → access" stays synchronous):

1. Installment 1 is an `authCaptureTransaction` with the Accept.js nonce — byte-for-byte
   the proven one-time purchase charge (CVV present), through the same approval,
   idempotency, reconciliation, and enrollment path. A decline leaves nothing behind.
2. After installment 1 settles — and before portal access is provisioned, so a portal
   failure can never undo a real charge — Authorize.Net builds a customer payment profile
   **from that transaction** (`createCustomerProfileFromTransactionRequest`). Card data
   never reaches Supabase. (The first design created the profile from the nonce and
   charged installment 1 against it; that was changed on 2026-09-02 because a
   profile charge carries no CVV, while every real approved charge so far had CVV matched.)
3. An ARB subscription for the remaining installments is created on that profile, monthly,
   starting one month after the purchase date (clamped to month end). If profile or ARB
   creation fails, the plan is `schedule_pending`, an alert goes to `PLAN_ALERT_EMAIL`
   (default office@), and the office creates the schedule from the merchant interface;
   nothing is charged twice.
4. `registration_payment_plans` (one per registration: profile ids, subscription id,
   split, paid totals, status) and `registration_installments` (one row per installment)
   are service-role only. `registrations.amount_cents` stays the full contracted total so
   existing reports and `contacts.total_spent` reflect the commitment; `paid_cents` on the
   plan tracks what has settled.
5. `cfa-plan-sync` (ops-token guarded, no CORS) calls `ARBGetSubscriptionRequest` for every
   open plan and writes each installment's result back. ARB `payNum` 1 is installment 2.
   Subscription `suspended` → plan `past_due`; `expired` with every installment paid →
   `completed`. It never charges, cancels, or changes anything at the gateway. Deploy it with
   `--no-verify-jwt` (like `cfa-learn-welcome`): the ops token is the gate, and the desktop
   cron that calls it carries no Supabase key. It runs daily at 06:40 ET from Sage's desktop
   (`sagerock/clients/center-for-anthroposophy/starlight-2026/cron-plan-sync.sh`, Cron
   Monitor job `cfa-starlight-plan-sync`, wired 2026-09-02): healthy days are silent,
   `past_due`/`needs_attention` plans go to Sage on Telegram and mark the heartbeat degraded,
   and a run that never happens is caught by the monitor's missed-heartbeat alert.

Operating notes:

- Authorize.Net does not retry a declined installment. The subscription is suspended and
  the merchant account's ARB notification email fires; after the participant updates their
  card in the merchant interface the office reactivates the subscription and re-runs the
  sync. **Access is not revoked automatically on a missed installment** — that is a CfA
  decision made by hand (set `enrollments.revoked_at`).
- The production test path (`REGISTRATION_TEST_MODE`) also covers the plan offer: $1 split
  five ways, first installment charged and voided, the ARB schedule created and immediately
  cancelled, and the stored card deleted. The response's `plan_test` block and the plan
  row's `notes` report each step. The merchant account's fraud filter holds a $1 test charge
  for review (`responseCode 4`, reason 252 — every $1 production test since 2026-08-16 looks
  this way, while every real charge has been approved), and a held transaction cannot seed a
  customer profile. Set `REGISTRATION_TEST_AMOUNT_CENTS` (e.g. `5000`) for the armed run so
  the first installment is approved; test mode also treats a held charge as approved so a $1
  run still exercises the rest of the harness. Unset it again when disarming.
- The authorization sentence shown at checkout for a plan reads: "I authorize the Center for
  Anthroposophy to charge my card $84 today and $84 on the same day of each of the next 4
  months (5 payments, $420 total), and I understand that registration is subject to CfA's
  cancellation policies." CfA has not yet reviewed this wording.

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
- **Gate 8 (payment plan) — passed 2026-09-02.** Sage ran the armed plan test in the
  browser at `REGISTRATION_TEST_AMOUNT_CENTS=5000`: the $10 first installment was approved
  (AVS Y, CVV M), `createCustomerProfileFromTransaction` succeeded, ARB subscription
  `74232976` (4 × $10, 2026-10-02 → 2027-01-02) was created and then cancelled, the profile
  deleted, the charge voided, and the plan row records
  `subscription_created=true subscription_cancelled=true profile_deleted=true` with five
  voided installment rows. Residue check against the pre-test baseline: zero new contacts,
  Auth users, identities, or enrollments. Two earlier runs the same day found (a) the $1
  charge being held by the fraud filter, which stops profile creation, and (b) the ARB
  request's `order` element placed after `profile` (E00003); both fixed before this pass.
- **Gate 7 — code-verified 2026-08-18; live exercise folded into gate 5.** Three
  layers prevent a second automatic charge after charge-but-no-access: replaying the
  same idempotency key against an `enrollment_pending` registration returns 409
  before any gateway call; a new attempt for the same email and program 409s while
  any pending record exists; and `registrations_one_active_email_program_idx`
  enforces one active registration per email and program at the database.
