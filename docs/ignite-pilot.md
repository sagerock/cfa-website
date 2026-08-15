# Ignite learning portal pilot

The `/learn` portal is an authenticated pilot at
`https://learn.centerforanthroposophy.org`. Public marketing content remains static,
while course access comes from Supabase after a participant signs in by email magic link.

## Pilot boundary

- One course: Ignite, using the current 2026–2027 seminar sequence previously managed
  as Starlight Rays.
- Live-session pages with private Zoom access.
- Course resources and welcome-letter access.
- Mux-hosted recordings.
- Supabase magic-link authentication and course entitlements.
- Existing CfA email tooling for welcome and reminder messages.
- Registration/payment integration follows after the learning flow works.

The pilot does not include quizzes, certificates, discussion forums, or a replacement
payment form.

The historical Thinkific identity is explicit: this pilot maps to Starlight course
`3357450`. Thinkific also contains a separate product named “Ignite! Summer Residency”
(`3358198`); migrations must use source IDs and never match either program by name.

## Runtime architecture

```text
Astro on Cloudflare Pages
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
    "slug": "ignite",
    "title": "Ignite",
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

The eventual database should keep existing CRM contacts separate from login identities:

- `contacts`: existing CfA people records in the email tool.
- `auth.users`: only people who need to sign in.
- `cfa_learn_profiles`: link an auth identity to the existing contact.
- `cfa_learn_courses` and `cfa_learn_sessions`: operational course content.
- `cfa_learn_enrollments`: the entitlement granting access.
- `cfa_learn_resources`: private files or links associated with a course/session.
- `cfa_learn_email_events`: welcome/reminder delivery and resend history.

All `cfa_learn_*` tables require Row Level Security. Zoom URLs and Mux signing keys must
never be exposed through anonymous policies or built into the Astro output.
Authenticated users also have no direct table grants; a verified
Edge Function returns only the learner-safe fields in the contract above.

The migration in `supabase/migrations/20260815000000_ignite_learning_pilot.sql` was
applied to the shared Supabase project for this pilot. It creates only prefixed
`cfa_learn_*` tables, revokes direct browser table access, and retains enrollment-based
RLS as defense in depth. `cfa-learn-course` is the only learner-facing data endpoint;
it validates the bearer token and active enrollment before returning course content.

The first test enrollment links the existing `sage@sagerock.com` Supabase Auth account
to Ignite. The shared project's existing Auth redirect allow-list was preserved and
extended with the learning subdomain, the Pages preview route, and local development.

## Mux test

Mux's free plan is sufficient for this pilot. After creating the account:

1. Create an environment-scoped access token with Video Read and Write permissions.
   The Mux Data environment key alone cannot upload or manage assets.
2. Store `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` only in the server-side secret store;
   `.env.example` documents the variable names without carrying values.
3. Upload one non-sensitive test recording.
4. Use public playback for interface testing only.
5. Never put a playback ID in `src/data/ignitePilot.js` or other statically built data.
6. Before inviting participants, create the player client-side only after a verified
   Supabase Edge Function returns a short-lived signed playback token. The checked-in
   player intentionally remains in its empty state until that flow exists. Never render
   the token during Astro's static build.

## Release gates

1. One internal user completes magic-link sign-in and sees only Ignite.
2. A second authenticated account without enrollment receives an access-denied response.
3. One test Zoom link and signed Mux recording work for the enrolled user but not anonymously.
4. The email tool records and resends a welcome message.
5. Only then connect a registration form or import a participant roster.
