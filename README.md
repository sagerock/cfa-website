# cfa-site — Center for Anthroposophy, rebuilt

Proof-of-concept rebuild of [centerforanthroposophy.org](https://centerforanthroposophy.org)
as a **lean, agent-editable static site**: content lives as Markdown and JSON in this repo,
Astro renders it, the host serves static files. No WordPress, no page builder, no plugins.

**This is not the live CfA site.** It's the working proof for the off-WordPress rebuild
(background: `sagerock` monorepo → `clients/center-for-anthroposophy/site-rebuild/`).
Every page carries a proof-of-concept banner. CfA governance is draft-and-stage —
nothing replaces the live site without CfA's go-ahead.

## How it works

```
src/content/spine/   20 real pages (About cluster, all program landings, residency info)
                     as Markdown — extracted from the live site 2026-07-21
src/data/
  courses.json       WHS Teacher Education catalog — 45 courses
                     (collapsed from 73 orphaned WordPress pages)
  faculty.json       100 faculty with program tags; no tags = archived/retired
  programMeta.js     program architecture + faculty-tag mapping
src/pages/           home · programs (index + per-program) · faculty (filterable) · about
public/images/       170 images, downloaded — zero dependency on the old server
```

To edit the site: edit a Markdown/JSON file, commit, push — the host rebuilds.
Which means an AI agent can edit the whole site, and every change is a reviewable diff.

## Develop

```
npm install
npm run dev      # local dev server
npm run build    # static build → dist/
```

Deployed on Render as a static site (auto-deploy on push to main).
