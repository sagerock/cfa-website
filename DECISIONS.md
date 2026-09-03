# Decision log

Dated record of significant decisions and the reasoning. Newest at the bottom.
Add an entry whenever a choice would make a future reader ask "why is it like this?"

## 2026-07-21 — Leave WordPress entirely (the founding decision)
Sage's read: WordPress's "non-technical people edit their own site" promise failed at
CfA — only Sage and Vern (departing) ever touched it. Thesis: if people edit by
talking to an AI, participation goes up. That kills WordPress's reason to exist here:
content moves to git (Markdown/JSON), an AI session or email becomes the editor, a
static generator renders. Git also gives CfA's draft-and-stage governance for free
(branch = draft, preview = stage, merge = publish, revert = undo).

## 2026-07-21 — The audit: the site is ~30 real pages, not ~700 objects
Full inventory via WP REST: 349 published pages + 103 drafts + 273 posts + 52 events +
Ultimate Member. Sage confirmed Events Calendar and UM groups are UNUSED. The real nav
(from Sage) is ~30 designed pages; the rest is test/copy/orphan sediment. Notable: the
73-page WHS cluster is a course catalog with ZERO inbound links (Google-indexed
orphans — Sage, who works in that program, had never seen them). 68% of the 2,650
media-library images are referenced by no page.

## 2026-07-21 — Collapse the WHS catalog: 73 pages → courses.json
44 course pages (+ dupes) became one data file of 45 course records + one template.
Adding a course = adding a row. Same collapse pattern applies to any future
catalog-shaped content.

## 2026-07-21 — faculty.json and the "no tags = archived" rule
The old site's faculty page was an Elementor EAEL filterable gallery; filter buttons =
program tags. Sage's actual practice: removing all of someone's tags "keeps them in
the database but inactive." Encoded as `active: programs.length > 0`; archived people
are never deleted. Two misspelled ghost tags fixed during extraction. "Program
Directors" is a faculty tag, not a page.

## 2026-07-21 — Extraction method: WP REST content.rendered → Markdown
Elementor's rendered output IS in the REST `content.rendered` field on this site, so
no front-end scraping or Elementor-meta parsing was needed — strip the div soup to
Markdown. Gotchas: AIOS blocks the default python User-Agent (send a browser UA);
bulk page requests time out (fetch per-ID, skip-on-fail); one page (dead UM "Groups",
id 32946) 500s server-side. Full pipeline + 621-file archive: monorepo
`site-rebuild/`.

## 2026-07-21 — Stack: Astro + Render, repo = CMS
Astro for content-first static rendering; Render because SageRock already holds an
API key (service created programmatically), free static hosting, auto-deploy, and
**per-PR preview URLs** — which map 1:1 onto CfA's draft-and-stage governance.
Hosting cost ≈ $0 vs. WP hosting + NitroPack + security stack. Repo public (content
is already public); named `cfa-website` because an unrelated 2024 `CfA-Site` repo
exists. All 170 referenced images downloaded into the repo — zero runtime dependency
on the old server.

## 2026-07-21 — Design: "Notebook & Blackboard"
Deliberately not the AI-default warm-cream-serif. Light = oat paper / pine-viridian /
goldenrod; dark = literal Waldorf chalkboard (slate-green, chalk-luminous). Native
serif stack (Iowan/Palatino) — the anthroposophy book world, with no webfont risk.
Lemniscate (form-drawing figure) as the mark.

## 2026-07-21 — Forms: keep Authorize.Net, drop Gravity Forms (plan only)
Milan prefers Authorize.Net — which is a gateway API, not a WordPress feature, so
leaving WP doesn't disturb it. Plan (monorepo `site-rebuild/FORMS-PLAN.md`): Astro
form → Supabase edge function (server-side pricing, Accept.js tokenization) →
Authorize.Net. Grounded in live GF form #116's real requirements (US/CAD pricing,
deposit vs full, 10-check plans, discount codes, 3% card fee, courses-first).
Deferred; target Renewal 2027.

## 2026-07-22 — The email doorbell (Tier 1 of "others can edit")
Email sage+cfaedit@sagerock.com → headless-Claude cycle (doorbell/AGENT.md) makes the
edit on a `doorbell/*` branch → PR → Render preview → replies with link → merges ONLY
on an explicit YES reply. Chosen over a chat-box product (Tier 2) as first step:
email is where CfA staff already live, and it reuses SageRock's watcher patterns.
Sage explicitly approved creating the autonomous agent ("rolling back is never an
issue"). No cron yet — attended cycles during the pilot. First real ring correctly
DECLINED an out-of-scope template request — the guardrails' first live test passed.

## 2026-07-22 — Per-sender scopes + the anti-self-modification ceiling
`senders.json`: each sender gets glob-scoped edit rights and an approve flag.
Policy (Sage): program directors self-approve within their own pages; Milan and Sage
get full scope. Live roster: sage@ (both addresses), milan@ = everything; karine@ =
Kairos; karen@ = Mentor Training + Leadership Development; deborah@ = Explorations;
david@ = WHS + Starlight + courses.json; elsy@ staged. Hard ceiling for everyone:
the doorbell can never edit `doorbell/**` or infra — no email may grant email-editing
power. Enabled ≠ invited: CfA folks don't know the address exists yet.

## 2026-07-22 — CTAs + first-party tracking (the owned-data loop)
Header "Request Info" CTA → `/contact` (real form) → Supabase → `/thank-you`; leads AND
analytics land in the SAME database, so CfA owns both their leads and their traffic data
(vs. scattering across a form vendor + Google Analytics they don't understand).
- **Backend:** Supabase project `dplaqxqnczmnxkuccsph` (existing SageRock "ai-engagement-hub",
  reused to avoid a $10/mo new project for a PoC). Tables `public.cfa_contact_submissions`
  and `public.cfa_page_events` (RLS on, no policies — only the service-role edge functions
  touch them). Edge functions `cfa-contact` and `cfa-track`, both `verify_jwt=false` and
  public (no key shipped to the browser; validated server-side). Endpoint base in
  `src/data/site.js`.
- **Analytics:** first-party beacon (`src/components/Analytics.astro`) — pageviews, CTA
  clicks (`[data-track]`), form_start/submit. No cookies, no third parties, no IP stored;
  a random sessionStorage id groups a visit. No consent banner needed.
- **Spam:** honeypot `company` field; server drops silently.
- **Not built yet:** email notification to CfA on new lead (store-only for now), and an
  admin/reporting view. Production → dedicated Supabase project ($10/mo) for true isolation.
- Gotcha fixed: a 204 response must have a `null` body, not `""` (else the edge function
  500s after a successful insert).

## 2026-07-22 — Move leads into the Email Marketing Tool (leads = real CfA contacts)
Sage: "put the leads in the email tool — we have a ton of CfA leads in there already."
Backend moved from the borrowed ai-engagement-hub to the **Email Marketing Tool** Supabase
(`ckloewflialohuvixmvd`), where CfA is a real client (id `22500cd6-…`; 6,101 live contacts,
13,090 in `cfa_consolidated_people`).
- **Website leads now upsert into the live `contacts` table** via `public.cfa_website_lead()`
  — a SECURITY DEFINER fn that only ever writes CfA's client_id, deduped on the existing
  unique index `(email, client_id)`, and is **non-destructive**: fills blank names, keeps the
  existing `source_code`, MERGES tags, latest message wins. New leads get `source_code='website'`
  + tags `['website-inquiry', <program>]`; phone/message/program go in `intake_data`/`intake_summary`.
- CfA runs **opt-out** (Sage: "no opt-in stuff, just unsubscribes; everybody's opting in") — so
  website leads become full contacts like everyone else, just tagged. Purchase history
  (`total_spent`/`order_count`) auto-attaches via the existing WooCommerce sync (email-deduped).
- `cfa-contact` + `cfa-track` redeployed to this project; `cfa_page_events` table recreated here;
  frontend `FN` base repointed (`src/data/site.js`). ai-engagement-hub cfa_ tables dropped;
  its old functions are orphaned/unused (couldn't delete via MCP).
- **Gotcha:** a SECURITY DEFINER fn with `set search_path=public` broke the contacts
  unsubscribe-token trigger (uses `extensions.gen_random_bytes`); fix = `search_path=public, extensions`.
- **Action for Sage:** move the `SENDGRID_API_KEY` secret to THIS project (it's on the old one) to
  re-enable notification email. Leads still save without it (service role); only email is dormant.
- Security: enabled RLS on 4 exposed Cvent tables in this project (was off → anon-readable).
- Spam note: the contact endpoint is public and writes to production contacts (honeypot + email
  validation only) — add rate-limit/Turnstile before real launch; junk is filterable by source_code='website'.

## 2026-07-22 — Analytics/leads dashboard (/dashboard)
One-screen owned-analytics view — the thing CfA needs but Google Analytics never gave them
(they don't understand GA). Summary tiles (pageviews / visits / CTA clicks / leads + a
visit→lead rate), a 30-day daily-traffic bar chart (single brand-green series, hover tooltips),
top pages, and recent leads. Data via `public.cfa_dashboard_stats()` (jsonb, one call) behind a
token-gated `cfa-stats` edge function; **lead emails are masked server-side** before leaving.
Page is `noindex` + unlinked; the token lives only in the URL hash (viewer supplies it, never
baked into the built page). PoC token is a constant in the cfa-stats function (rotate by
redeploy); productionize with a per-user login. URL: `/dashboard#<token>`.

## 2026-07-22 — Referral / traffic-source tracking (ad attribution)
"Where do people come from?" The beacon already recorded `referrer`; now it also captures
UTM tags and stores a **first-touch source** per visit (sessionStorage), attached to any lead
that visit. `public.cfa_source_of()` classifies referrer/utm → Google / Facebook / LinkedIn /
Bing / Newsletter / Direct / Other. Dashboard shows a "Where visitors come from" panel + each
lead's source. Lead attribution persists in `contacts.utm_params` + `intake_data.source`.
Closes the SageRock-marketing loop: tag ad links with `?utm_source=linkedin` and leads trace
to the channel. Demo data seeded (110 pageviews across sources, 9 CTA, 3 leads — all
@example.com / session_id `demo-%`, clearable). Seed gotcha: `random()` in a non-correlated
`lateral` evaluates ONCE — use `id % N` into a weighted array for per-row variety.

## 2026-07-22 — Bring the blog in-house (/news section)
The About/Goetheanum "News & Views" and "Read All" linked back to WordPress; the content
(273 posts, incl. the Center & Periphery newsletters) was already in the archive. Imported all
273 as a `posts` collection with real publish dates (re-fetched from WP `date`), cleaned bodies,
and 414 local images (35 MB). Routes: `/news` + `/news/page/[page]` (paginated, 24/pg) for the
index, `/news/[slug]` for posts — kept on separate path segments to avoid the `[slug]`↔`[...page]`
Astro route collision. Added News to nav. Restored newsletter TOCs: empty extraction links
`[](wp-url)` relabeled from the target post's title; 1,392 cross-post links localized to
`/news/<slug>`, 59 dead empties dropped — blog is now internally self-contained. 23 images
failed to localize (still hotlink WP). Reusable prep in scratchpad prep_news.py.

## 2026-07-23 — Trusted doorbell edits publish directly to main
Sage found the preview → YES → merge round trip too frustrating for routine website
edits and explicitly chose WordPress-like immediacy. This supersedes the approval step
in the 2026-07-22 doorbell decision: an enabled sender's unambiguous, in-scope email is
itself authorization to publish. The agent builds first, creates one attributed commit,
pushes it directly to `main`, and emails a precise confirmation. Git history is the
rollback mechanism; a clear UNDO reply reverts that request's commit. Unauthorized,
out-of-scope, ambiguous, conflicting, or build-breaking requests never publish. The
anti-self-modification ceiling remains absolute: email can never edit `doorbell/**`,
sender permissions, or infrastructure. The current runner is still machine-local; moving
the same policy into an always-on hosted worker is a separate implementation step.

## 2026-07-23 — Host the doorbell on Ask via SendGrid, pilot in dry-run
The local Gmail poller is retired. `cfa-site@ask.sagerock.com` now uses the existing
SendGrid Inbound Parse → Railway Ask pipeline, so incoming mail triggers work immediately
without Sage's computer. A durable Postgres queue hands requests to a separate worker using
`openai/gpt-5.6-sol` at high reasoning. Runtime sender scopes live in Ask's encrypted mailbox
configuration, not in the editable target repository. The initial pilot authorizes only
`sage@sagerock.com`, has no GitHub write credential, and requires both mailbox `mode=live`
and `CFA_SITE_PUBLISH_ENABLED=true` before publishing is possible. Dry-run still clones the
real public repo, produces the smallest edit, deterministically checks scopes/protected paths,
preserves the PoC banner and noindex, runs the full Astro build, and emails the result. After
attended tests pass, live activation will implement the direct-to-main policy above.
Before the first external test, Milan was also added with full dry-run scope so he can try
the workflow safely; no publishing capability was added.
Later that day, Sage installed a fine-grained token restricted to `sagerock/cfa-website`.
The two publish gates remain off. This personal token is appropriate for the pilot; the
reusable production model should use a GitHub App installed per client repository, issuing
short-lived installation tokens instead of depending on Sage's personal credential.

## 2026-07-23 — Prefer per-repository GitHub App credentials
The hosted worker now supports the reusable credential model: when an App ID and private
key are configured, it signs a short-lived App JWT, discovers the App installation from
the fixed repository, and requests a token limited to `cfa-website` and `contents: write`
for each job. The token is available only to Git subprocesses, never to Sol or the Astro
build. Partial App settings fail closed. The fine-grained personal token remains a temporary
fallback until a real App dry-run verifies clone access; it will then be removed without
changing either publish gate.
The production credential preflight subsequently verified App JWT signing, installation
discovery, token issuance, and authenticated repository access. The personal token was
then removed from the worker and the service redeployed successfully; both publish gates
remain off.

## 2026-07-23 — Activate direct publishing for the private email pilot
Sage explicitly chose WordPress-like immediacy over continuing dry-run previews: seeing a
requested edit appear on the Render site is the point of the experiment, and every change
is recoverable with a normal Git revert. The encrypted mailbox mode and independent Railway
gate are therefore enabled for Sage and Milan. Unambiguous, in-scope requests publish one
attributed commit directly to `main` only after deterministic validation and a complete
Astro build; Render auto-deploys it and the worker replies with the result. Ambiguity,
authorization failures, protected paths, stale branches, and build failures still stop.
The PoC banner and `noindex` remain mandatory because this activates editing, not public
launch approval.

## 2026-07-24 — Host moved: Render → Cloudflare Pages
Same evening as the parallel sagerock-website move, and for the same reason: SageRock's
hosting consolidated onto Cloudflare, where DNS for all client zones already lives and
where multi-person account access is free (Render charges per seat). Nothing about the
site or its editing flows changed — the doorbell and AI sessions both end in a commit to
`main`, and only the service watching that branch is different. Production URL is now
https://cfa-website-bqx.pages.dev (Cloudflare appended the `-bqx` suffix to the pages.dev
subdomain). The Render service `srv-d9g2hvflk1mc739qd9e0` is retired. Historical entries
above that say "Render" describe the host as it was at the time and are left as written.

## 2026-08-15 — Prototype a first-party learning portal with Ignite
Sage chose the direction of leaving Thinkific as well as WordPress. The pilot is an
unlinked `/learn` experience for Ignite, using the 2026–2027 seminar sequence previously
managed as Starlight Rays. It extends the existing architecture rather than introducing
another all-in-one platform: Astro renders the interface, Supabase will own authentication
and entitlements, Mux will host recordings, and the existing CfA email tool will send and
log welcomes and reminders. Git remains the CMS for public content only; student records,
Zoom links, private resources, and signing credentials never enter this public repository.
The first commit is deliberately an interface and data-contract prototype. It does not
create live access, change the public Starlight page, or migrate participants.

## 2026-08-15 — Pilot on learn.centerforanthroposophy.org
The first learning portal preview uses `learn.centerforanthroposophy.org`, attached to the
existing Cloudflare Pages proof-of-concept project. A hostname-specific redirect sends only
that subdomain's root to `/learn`; it does not change the main Pages preview or the production
WordPress hostname. This is intentionally a low-infrastructure pilot. If CfA approves the
portal for real participant use, it should receive its own Cloudflare Pages project before
the authenticated application becomes operationally independent from the public site.

## 2026-08-15 — Authenticate the Ignite pilot through shared Supabase
Sage approved moving the preview into a real one-user access test. The shared Supabase
project already holds CfA contacts and Sage's Auth account, so the pilot uses isolated
`cfa_learn_*` tables there rather than creating another database. Direct grants to browser
roles are revoked: the `cfa-learn-course` Edge Function validates each bearer token and
active enrollment before returning course fields, including any future Zoom URL. The first
manual enrollment is `sage@sagerock.com`; no other contact becomes an Auth user or learner.
Magic links use PKCE and the existing Auth redirect allow-list was merged, not replaced.

## 2026-08-15 — Correct the pilot identity to Starlight Rays
The first portal prototype incorrectly used the name Ignite for Thinkific course `3357450`.
That course is Starlight Rays 2026–2027 (product `3683719`); Ignite! Summer Residency is
a separate course (`3075585`, product `3358198`). The live pilot is therefore renamed to
Starlight Rays, and future imports and payment mappings must use source IDs rather than names.
The old `/learn/ignite` path redirects to the corrected Starlight route.

## 2026-08-18 — Full cutover to the new platform for Sept 5
Elsy decided the migration question (option a in the Sept 5 launch map): all 74 Starlight
Rays participants move to the new portal for the Sept 5 first session, and Thinkific becomes
the archive rather than parallel-running the season. The contacts-and-enrollments half of
that migration already ran on 2026-08-17 (74 Thinkific-source enrollments, batch
`starlight-thinkific-2026-08-16`, zero Auth users — identity stays just-in-time). What the
decision adds is the second half: after the seven release gates in `docs/starlight-pilot.md`
pass, bulk magic-link invitations bring the 74 into the portal. Sequencing is explicit —
**gates first, then bulk invite**; nobody outside the internal test accounts gets an
invitation while any gate is open. Thinkific itself stays untouched (live, paid enrollees)
until the Nov 10 renewal decision; roster parity for David's per-school mailing groups must
survive the cutover.

## 2026-08-18 — Waive gate 6 (sandbox payment project)
Sage decided to skip the separate non-production Supabase project that release gate 6
called for. Payment verification rests on gate 5's purpose-built $1-charge-and-void
production test instead. The accepted trade-off, stated plainly: the failure paths
(declines, gateway timeouts, charge-succeeds-but-enrollment-fails) stay code-verified
only — reviewed in the deployed cfa-register source and enforced by the database's
one-active-registration index, but never exercised end-to-end against a sandbox
gateway. Sandbox checkout remains disallowed against the shared production database;
if tuition-scale payments (25-month HS program, Oct/Nov) warrant it later, a
disposable test project can be created then.

## 2026-08-19 — Coupon codes and live registration, built for the Elsy demo
Sage decided Elsy's Aug 20 walkthrough should be a real registration on the live form,
so percent-off coupon support was designed, built, and rehearsed in one day, and
`REGISTRATION_LIVE` was turned on permanently ahead of the cancellation-language nod
(Sage's explicit call: anyone who finds the unlinked form and pays is a legitimate
enrollee). Coupons are server-authoritative (`program_coupons`, atomic claim-before-
charge); a 100% code produces a $0 registration that skips Authorize.Net entirely and
records a synthetic `comp-` transaction reference — `amount_cents` now means "amount
charged," with `discount_cents`/`coupon_code` preserving the ledger. The live rehearsal
caught four production landmines (Turnstile global shadowed by `id="turnstile"`, the
`amount_cents > 0` constraint, the unsubscribe-token trigger breaking every brand-new-
contact registration, and idempotency-key pinning) — all fixed same-day. An adversarial
cross-model review is logged in `ai-collab/2026-08-19-starlight-coupon-live-registration.md`;
its verdict: demo-ready, but the GET coupon oracle needs throttling, declines must not
burn coupon uses, and the trigger fix must be schema-qualified in the email tool's own
repo before the invitation wave. `ELSY100` (100%) expires end of Aug 20.

## 2026-08-20 — PoC banner removed; noindex stays (the Elsy walkthrough call)
During Elsy's live walkthrough, Sage directed a round of CfA-owned branding changes —
the real 2024 logo replacing the placeholder mark, the slogan ("Discover your destiny,
practice your passion.") into the header, the corrected founding year (1996, not 1981),
and removal of the Wilton/Keene location language since the programs are fully online —
and then removal of the proof-of-concept banner. That instruction, given with CfA on the
call directing the session, is the formal approval the banner rule waited for. `noindex`
remains until the WordPress→new-site domain cutover is decided, so search engines never
see two competing copies of the content. The PO Box mailing address was kept in the
footer and contact page pending explicit direction.

## 2026-08-21 — Stage the new giving page before replacing donation checkout
Torin asked Sage for an upgraded annual-appeal experience, using Free Columbia's donation
page as a reference. The rebuilt site now has a native `/donate` campaign page and a
prominent Donate header action: concise appeal copy, CfA program photography, 2024-25
participation evidence, current fund designations, recurring/check/planned-gift guidance,
and first-party CTA tracking. It deliberately does not repeat the prior appeal's match
language because the next appeal's goal, deadline, and matching terms are not confirmed.
Payment still hands off transparently to live WordPress Gravity Form 97. That form has no
supported external-prefill parameters and cannot safely be embedded or posted to from the
static Astro site. A native donation checkout therefore waits for a donation-specific,
reconciled Authorize.Net endpoint and controlled payment test rather than pretending the
registration endpoint is interchangeable. `noindex` remains unchanged.

## 2026-08-26 — One classroom with session-scoped Starlight access
Elsy asked for the three featured $19 sessions to live inside the CfA classroom rather
than arrive as bare Zoom links, with locked previews and an “Unlock Full Series” path.
The platform therefore keeps one Starlight course and adds explicit offer and enrollment
session entitlements. Rawson, Blanning, and Kaliks each grant one session; the $44 bundle
grants all three; the $420 individual and $1,220 institution offers retain all twelve.
The course endpoint removes private Zoom/resource data from locked sessions, playback and
reminder endpoints enforce the same entitlement server-side, and the classroom shows the
rest of the schedule as locked previews. A full-series purchase upgrades the existing
enrollment to all-session access. It currently charges the published $420 price; no credit
for earlier single-session purchases is automatic without CfA approving that money policy.

## 2026-08-27 — Institutional purchases become self-service rosters
Elsy asked to remove the office back-and-forth after a school buys the $1,220 Starlight
institution offer. The purchaser now receives a private, expiring roster link instead of
being treated as the single learner; they may enter or import up to 20 participants and
review first name, last name, email, title/role, and middle/high-school teacher-training
completion before submitting. Each reviewed participant receives an individual full-series
enrollment and personal sign-in email automatically. Private roster tokens are stored only
as hashes, browser links carry the raw token in the URL fragment, participant rows stay
service-role-only, and the existing staff dashboard exposes masked delivery status plus
explicit resend/retry controls. Already provisioned participants cannot be silently removed
or have their login email changed from the public roster. The checkout card now states the
20-person limit, and institutional buyers who already have personal Starlight access are
still allowed to purchase for their school.

## 2026-08-27 — Per-person dashboard viewer tokens
Sage couldn't get into `/dashboard` and Sascha (HolyOps) needs a view of leads, registrations,
and revenue. Cause: `cfa-stats` had its token hardcoded in the function (source lived only in
the deployed copy) while `cfa-registrations` read a `DASHBOARD_TOKEN` secret — two different
tokens, neither recorded. Fix: `cfa-stats` is now vendored into this repo; both functions read a
comma-separated `DASHBOARD_TOKENS` secret (one token per person, prefixed by name, so any one can
be revoked alone), falling back to the legacy `DASHBOARD_TOKEN`. Tokens are handed out directly,
never posted in the shared Slack channel; the values live in `/mnt/d/dev/.env` on Sage's machine.

## 2026-08-31 — Publish Center & Periphery first on its own subdomain
Sage chose the rebuilt site's edition-and-article reader for the Fall 2026 Center & Periphery
instead of creating another Elementor issue in WordPress. `news.centerforanthroposophy.org`
points at the existing Cloudflare Pages project, but behaves as a publication front door:
its root opens a dedicated edition archive, issue articles retain their table-of-contents
sidebar, and non-publication navigation returns to the live WordPress site. This is a scoped
section launch, not the whole-site cutover. Center & Periphery pages carry an indexable robots
directive and canonical URL for the news hostname; Pages middleware adds an HTTP `noindex`
guard on every other hostname so the Pages preview cannot compete with production. The rest
of the rebuilt site remains `noindex`.

Elsy is invited to the existing `cfa-site@ask.sagerock.com` live editor with the narrow
repository scope `src/content/posts/**`. She can create and revise Center & Periphery issue
and article Markdown, while site code, layouts, deployment configuration, program data, and
the editor's own policy remain outside her authority. Sage and Milan retain full-site scope.

## 2026-08-31 — Optimize emailed publication images into S3
Sage chose to let Elsy attach article images directly to her Ask emails, while also preventing
the oversized original uploads common in WordPress workflows. After sender authorization,
Ask accepts only JPEG, PNG, or WebP raster images; rejects animation, oversized files and
pixel counts, SVG, and arbitrary binaries; applies camera orientation; caps the long edge at
2,400 px; strips embedded metadata; and encodes WebP at a web-appropriate quality. Optimized
objects use immutable, content-derived keys under
`sagerock-email-images/center-for-anthroposophy/center-periphery/YYYY/MM/`. Only the public
URL and dimensions enter the durable job and Markdown. This keeps binaries out of Git and
does not broaden Elsy's `src/content/posts/**` repository scope.

## 2026-09-02 — Incident: every individual and session registration since 08-26 failed at enrollment
Migration `20260826170000_starlight_session_entitlements` added statements referencing
`enrollment_session_access.enrollment_id` inside `cfa_complete_registration`, whose
`returns table (contact_id, enrollment_id, user_id)` OUT parameters are PL/pgSQL variables of
the same names. Every call raised `column reference "enrollment_id" is ambiguous`, so from
2026-08-26 on, each non-institution purchase charged the card and then landed in
`enrollment_pending` with no portal access and no welcome email. Two real customers were hit
($420 on 09-01, $44 on 09-02) before it was noticed on 09-02 while starting the payment-plan
work. Institution purchases were unaffected because they complete through a different function.
Fix: `#variable_conflict use_column` (migration `20260902120000`), signature unchanged, no
function redeploy. The two registrations were completed by re-running the repaired function and
their portal welcomes sent via `cfa-learn-welcome`. Lesson recorded: the daily gate-check does
not exercise a real purchase, so a broken completion path is invisible until a customer pays.
A `registrations.status = 'enrollment_pending'` row older than a few minutes is an alarm, not a
queue.

## 2026-09-02 — Starlight Rays five-payment plan: charge installment 1 now, ARB for the rest
Sage asked for a five-payment plan on Starlight Rays. Decisions, all Sage's: individual offer
only (not institution); same $420 total as paying at once, no surcharge; and the CIM-plus-ARB
hybrid over a pure ARB subscription or manual invoicing. The hybrid keeps installment 1 on the
existing synchronous charge path (so access is still granted only after money has settled and
gate 7's double-charge protections still apply), and hands the remaining four monthly charges to
Authorize.Net's scheduler rather than building a charger and dunning engine here. Full mechanism
and operating notes in `docs/starlight-pilot.md` → Payment plans. Known gaps accepted for the
launch: no automatic access revocation on a missed installment; reconciliation (`cfa-plan-sync`)
is run by hand or by a scheduler, not by webhook; the checkout authorization sentence has not
been reviewed by CfA.

## 2026-09-02 — Percent-off coupon codes
Sage asked for 10/20/30/50% coupons alongside the plan launch. Created `STARLIGHT10`,
`STARLIGHT20`, `STARLIGHT30`, `STARLIGHT50` on the Starlight program with no expiry and no use
cap; they apply to every offer, including the plan (discount taken from the total before the
split). Cap or expire them by updating `program_coupons` when CfA decides how they are used.

## 2026-09-02 — Plan path proven live; profile built from the first charge, not the nonce
The first plan design created the Authorize.Net customer profile from the Accept.js nonce and
charged installment 1 against the profile. The first live test showed that profile charge would
be the only CVV-less charge in the system (every real approved charge has CVV matched), so the
design was changed the same afternoon: installment 1 is the same nonce charge as a one-time
purchase, and the profile is built from that transaction. Three armed production tests were
needed to prove the chain: the $1 test charge is held by the merchant fraud filter (as every $1
test since gate 5 has been, unnoticed because the harness voided and reported success), a held
transaction cannot seed a profile, and the ARB request had `order` after `profile`. The third
run at $50 ($10 first installment) created and cancelled ARB subscription 74232976 end to end.
Recorded as gate 8 in `docs/starlight-pilot.md`. The $1 harness's blind spot is now documented
and the test amount is configurable per run.

Also today, on Sage's report that 1Password would not offer to fill the billing address: form
labels now pair explicitly with inputs, the street field is `address1`, and the honeypot is a
`display:none` field with a neutral name instead of an off-screen text box named `company` —
an autofilled company name could previously have tripped the bot trap and faked a successful
registration. The Authorize.Net card lightbox is unchanged; moving card fields onto our page
(Accept.js hosted by us) would change CfA's PCI footprint and was left as a separate decision.

## 2026-09-02 — Charged-but-not-enrolled is now self-healing, and watched
Sage asked whether the system checks itself after the enrollment incident. It did not: the
incident was found by accident. Decision: an hourly `cfa-registration-heal` Edge Function
finishes any registration the gateway confirmed as paid but the site failed to enrol (same
idempotent completion routines, then the welcome), and reports what it cannot finish or what
needs a human at the gateway. Run from the desktop cron with a Cron Monitor heartbeat, like the
daily plan sync: healed/broken/needs-human → Telegram + degraded; nothing found → silent;
missed run → monitor alert. The function never retries a charge and never touches the gateway.

## 2026-09-02 — Payment plan repriced to $445; card fees built in, never itemized
Milan (with Curtis) asked for 5 × $89 = $445 so paying in full at $420 carries an incentive, and
asked who absorbs the ~3% card fee. Sage's decision: reprice the plan to $445 and build processing
into every price rather than adding a card surcharge line. Reasoning: CfA already pays the
percentage on every card charge, plan or not (the plan only adds about four extra per-transaction
fees, roughly $1.20); a higher price for the installment product is clean everywhere, while an
itemized "processing fee" runs into card-network rules and state surcharge bans and annoys
customers. Suggested to CfA separately: offer eCheck/ACH for the $1,220 institution fee, where
3% actually adds up. Data-only change to `program_offers.individual-plan`; the checkout computes
installments from the offer, so no code changed.

## 2026-09-02 — CfA approves one standard cancellation policy
Milan approved the proposed cancellation and refund policy as the standard policy for all CfA
programs on the rebuilt site. The review label was removed from `/policies/cancellation/`. A
program page with different terms still wins. Every current native Starlight offer uses the same
registration form, whose required authorization links to the policy; the registration welcome
email also includes the policy URL. Future native product checkouts should preserve both links.

## 2026-09-03 — Starlight checkout shows only the primary offers by default
Curtis asked to remove the alternate purchase options from the public registration path because
he and Sascha want payment plans, single sessions, and the three-session bundle offered through
abandoned-checkout follow-up or targeted email instead of competing at checkout. Sage confirmed
that Sascha owns this conversion decision. The default registration page now shows only the $420
individual series and $1,220 institution registration, and the public program page no longer
advertises the alternate offers. The underlying offers remain active and a targeted direct link
with `?offer=<code>` renders only that requested offer, so no payment or entitlement capability
was deleted.
