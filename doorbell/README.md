# The email doorbell — edit this site by sending an email

Private pilot of "others can edit the site without touching git." Email a change request
to **cfa-site@ask.sagerock.com**. SendGrid triggers a hosted worker on Railway immediately;
Sage's computer is not involved.

## Live pilot status

The mailbox currently authorizes `sage@sagerock.com`,
`milan@centerforanthroposophy.org`, and `elsy@centerforanthroposophy.org`, and
runs in **live mode**. Elsy's scope is limited to news and Center & Periphery
content under `src/content/posts/`; Sage and Milan retain full-site scope.
It uses `openai/gpt-5.6-sol` at high reasoning to edit a temporary clone, checks the complete
diff, and runs the full Astro build. Valid requests commit directly to `main`, Cloudflare
Pages deploys them, and the worker emails the result.

## Workflow

```
email → SendGrid webhook → authorize sender + scope → queue job → Sol edits temporary clone
      → deterministic checks → Astro build → commit to main → Cloudflare Pages deploy → confirmation
```

An unambiguous email from an invited sender is authorization to publish within that sender's
scope. There is no routine preview or YES round trip. A clear UNDO reply creates a normal
revert commit. Ambiguous, conflicting, out-of-scope, build-breaking, or unauthorized requests
never publish.

## Guardrails

- Runtime sender permissions live in Ask's encrypted mailbox configuration, outside this
  public repository. `senders.json` is a planned-roster reference only.
- Publishing requires both encrypted mailbox `mode=live` and the independent Railway
  variable `CFA_SITE_PUBLISH_ENABLED=true`.
- A GitHub App installed per repository supplies a short-lived token for each job; no
  personal GitHub token is installed on the worker.
- Email can never edit `doorbell/**`, `.github/**`, package/build configuration, environment
  files, or OpenCode configuration.
- The PoC banner and `noindex` are checked in source and in the built homepage.
- Every published change is an attributed commit; history is never rewritten.
- Replies are signed `— Claude (CfA site doorbell)`, never as Sage.

## Implementation

The hosted implementation lives in the private SageRock `ask` repository under
`tools/_custom/cfa/`. This directory records CfA policy and the retired local prototype;
`run.sh` no longer processes mail.
