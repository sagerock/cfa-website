# The email doorbell — edit this site by sending an email

Prototype of "others can edit the site without touching git": email a change request,
get back a **preview link**, reply **YES**, and it's live ~2 minutes later.

## How to use it

1. Email **sage+cfaedit@sagerock.com** with what you want changed, in plain English —
   e.g. *"On the Renewal Courses page, say that 2027 registration opens February 1."*
2. You'll get a reply with a summary of the change and a **preview URL** showing the
   whole site with your change applied. Nothing is live yet.
3. Reply **YES** → published. Reply with adjustments → the preview updates. Reply
   **no** → discarded.

## How it works

A polling agent (`run.sh` → headless Claude following `AGENT.md`) checks the inbox,
turns each request into a git branch + pull request, lets Render build a preview
per-PR, and only merges to `main` (= production) on an explicit approval reply.

```
email → agent edits a branch → PR → Render preview URL → "YES" reply → merge → live
```

## Guardrails

- **Draft-and-stage by construction**: no approval, no merge, no publish.
- **Sender allowlist** (currently `sage@sagerock.com`) — expand in `AGENT.md` when
  CfA folks join the pilot.
- **Content-only scope**: pages and data (`src/content/`, `src/data/`). Layout, styles,
  and code changes are declined and routed to a human.
- **Full audit trail for free**: every change is a commit + PR with the request quoted
  and the requester named. Git history *is* the change log.
- Doorbell replies are signed `— Claude (CfA site doorbell)`, never as a person.

## Status

Prototype (2026-07-21). Runs on Sage's machine via `run.sh` (manual or cron; no cron
entry installed yet). `state/` is machine-local and gitignored.
