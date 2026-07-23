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
