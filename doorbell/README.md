# The email doorbell — edit this site by sending an email

Prototype of "others can edit the site without touching git": an invited editor emails
a change request, and an unambiguous request within their scope publishes directly.

## How to use it

1. Email **sage+cfaedit@sagerock.com** with what you want changed, in plain English —
   e.g. *"On the Renewal Courses page, say that 2027 registration opens February 1."*
2. The agent checks your identity and editing scope, makes the change, verifies the full
   site build, commits it to `main`, and replies with exactly what was published.
3. Reply **UNDO** to that confirmation if the change should be reverted. If a request is
   ambiguous, the agent asks one focused question instead of publishing a guess.

## How it works

A polling agent (`run.sh` → headless Claude following `AGENT.md`) checks the inbox,
validates each request against `senders.json`, edits an isolated checkout, builds the
site, and pushes one attributed commit to `main`. Render then deploys automatically.

```
email → validate sender + scope → edit → build → commit to main → Render deploy → confirmation
```

## Guardrails

- **The email is authorization**: enabled senders publish unambiguous requests directly
  within their configured scope. There is no routine preview or YES round trip.
- **Ambiguity stops publication**: unclear, conflicting, out-of-scope, or build-breaking
  requests do not reach `main`.
- **Per-sender permissions** (`senders.json`): each person gets their own editable scope,
  from all site content down to a single program page.
- **Self-modification is impossible by design**: no email, from anyone, can change
  `senders.json`, the runbook, or site infrastructure. Permissions change only in a
  direct working session with Sage.
- **Full audit trail and rollback**: every change is an attributed Git commit. A clear
  UNDO reply creates a revert commit; history is never rewritten.
- Doorbell replies are signed `— Claude (CfA site doorbell)`, never as a person.

## Status

Prototype (policy updated 2026-07-23). Runs on Sage's machine via `run.sh` (manual or
cron; no cron entry installed yet). `state/` is machine-local and gitignored. Moving
the runner to an always-on hosted worker is still an implementation step.
