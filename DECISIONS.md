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
