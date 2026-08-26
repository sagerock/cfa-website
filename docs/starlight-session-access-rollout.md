# Starlight session-access rollout

This change is staged for review. It must not be treated as live until the database migration, Edge Functions, and site build are released together.

## Release order

1. Apply `20260826170000_starlight_session_entitlements.sql`.
2. Deploy `cfa-register`, `cfa-learn-course`, `cfa-learn-playback`, and `cfa-learn-remind`.
3. Publish the site build.
4. Update the launch-email cron to pass `--session-slug methods`; the weekly reminder script supplies the upcoming session slug automatically.

Releasing the site before the migration and functions would expose offer links that the current backend cannot fulfill. Releasing the migration alone is backward compatible: existing enrollments default to full-series access.

## Acceptance checks

- The registration page shows the three $19 session offers, the $44 three-session bundle, the $420 individual series, and the $1,220 institutional series.
- Each public featured-session link preselects its matching offer.
- A Rawson-only test enrollment can open `methods`, sees the other eleven sessions as locked previews, and receives a forbidden response if it calls playback for a locked session directly.
- A bundle test enrollment can open `methods`, `sensory-diet`, and `citizenship`, but no other session.
- A session buyer can later buy the full individual series; the existing enrollment becomes full access without creating a second classroom account.
- A full-series participant cannot buy a redundant session offer.
- Reminder dry runs include full-series participants plus participants entitled to the requested session, and exclude buyers of other sessions.
- The launch reminder targets `methods`; Friday reminders continue to resolve the next Saturday session automatically.

Use a short-lived 100% test coupon for acceptance checks and deactivate it immediately afterward. The full-series upgrade currently charges the normal $420 price. Crediting prior session purchases is a separate pricing decision and is not implemented.
