# cfa-website — Center for Anthroposophy, rebuilt off WordPress

**Live:** https://cfa-website.onrender.com · **Status: proof of concept** (not CfA's
production site — see Governance below)

This repo is both the **content and the code** of a rebuilt centerforanthroposophy.org:
pages are Markdown, structured data is JSON, Astro renders it all to static files, and
Render serves them. There is no WordPress, no page builder, no database, no admin
dashboard. **The git repo is the CMS**; editing happens either in an AI working session
or by email (see The Doorbell).

New here? Read this file, then `DECISIONS.md` (why everything is the way it is), then
`doorbell/README.md` (how non-technical people edit the site).

## Architecture

```
AI session → edit → build → commit to main → Render deploys
email doorbell → SendGrid trigger → hosted worker → validate sender/scope → edit → build
  → direct commit to main → Render deploy → confirmation email
```

- **Host:** Render static site `srv-d9g2hvflk1mc739qd9e0` (workspace "My Workspace").
  Auto-deploy on push to `main`; PR previews enabled. API key: `RENDER_API_KEY` in
  `/mnt/d/dev/.env` (Sage's machine).
- **Rollback:** `git revert` + push. That's the whole disaster-recovery plan, and it's
  a good one.

## Repo layout

```
src/content/spine/    the site's pages as Markdown (frontmatter: title, navLabel,
                      section: about|programs|residency, slug, order)
src/data/
  courses.json        WHS Teacher Education catalog — 45 courses {code, subject,
                      year 1-3, description}. Rendered as the catalog on the WHS page.
  faculty.json        100 people {name, programs[], photo, bio, active}.
                      RULE: empty programs[] = archived/retired faculty (kept on file,
                      hidden unless "Show archived"). This mirrors how CfA actually
                      managed the old site's gallery.
  programMeta.js      program grouping (the real CfA nav, per Sage) + program-slug →
                      faculty-tag mapping
src/pages/            routes: home, programs/+[slug], faculty (filterable), about/+[slug]
src/layouts/Base.astro   site chrome: PoC banner, sticky header, footer (real contact
                         info: PO Box 545 Wilton NH, 603-654-2566, office@)
src/components/PageHeader.astro   standard page opening (eyebrow/title/lede)
src/styles/global.css  the design system (see below)
public/images/         all 170 images referenced by content — downloaded, zero
                       dependency on the old WordPress server
doorbell/              email-driven editing (README, AGENT.md runbook, senders.json)
DECISIONS.md           dated log of every significant decision and why
```

## Design system — "Notebook & Blackboard"

Light mode = warm oat paper; dark mode = a Waldorf classroom chalkboard (slate-green
ground, chalk-luminous accents). Tokens live at the top of `global.css` (`--paper`,
`--ink`, `--green`, `--gold`, serif = Iowan Old Style/Palatino stack, sans = Avenir/
Segoe stack). Both themes are deliberate — keep them in parity when styling anything
new. The lemniscate mark in header/hero is drawn inline SVG, animated on the homepage.

## The three ways this site gets edited

1. **AI working session** (Sage + Claude): full scope — content, templates, styles,
   infrastructure. Commits directly to `main` with build verification.
2. **The email doorbell** (`doorbell/`): email `cfa-site@ask.sagerock.com` → SendGrid
   triggers a hosted Railway worker using Sol high. The current private pilot authorizes
   Sage and Milan. Unambiguous in-scope requests validate the full build, commit directly
   to `main`, and deploy through Render; UNDO creates a revert commit. Runtime permissions
   live in the hosted mailbox configuration; `doorbell/senders.json` is the planned roster,
   not authority.
3. **Plain git**: it's a normal repo. Clone, edit, PR.

## Provenance

All content was extracted from the live WordPress site 2026-07-21 via the WP REST API
(Elementor pages render into `content.rendered`; a converter stripped the markup soup
to Markdown). The full extraction — all 348 pages + 273 posts + media inventory, plus
the extraction tooling and audit findings — lives in the SageRock monorepo:
`sagerock/clients/center-for-anthroposophy/site-rebuild/`. This repo carries only the
curated live spine (~20 pages + data).

Registration forms are deliberately absent: the plan (SageRock-owned form + Supabase +
CfA's existing Authorize.Net gateway) is at `site-rebuild/FORMS-PLAN.md` in the
monorepo, targeted at Renewal 2027.

## Governance

CfA is a MEDIUM-governance client: this PoC has not been shown to or approved by CfA.
Sage explicitly activated direct publishing for the private Sage-and-Milan email pilot;
ambiguous or out-of-scope requests still stop without publishing.
Until CfA approves the rebuild, every page carries the "proof of concept" banner and a
`noindex` meta. Going live for real = CfA's call, plus: real domain, redirect map from old
URLs, forms answer, and removing banner/noindex.

## Develop

```
npm install
npm run dev      # local dev server
npm run build    # static build → dist/
```
