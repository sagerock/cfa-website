# The email doorbell — edit this site by sending an email

Private pilot of "others can edit the site without touching git." Email a change request
to **cfa-site@ask.sagerock.com**. SendGrid triggers a hosted worker on Railway immediately;
Sage's computer is not involved.

## Pilot status

The mailbox currently authorizes `sage@sagerock.com` and
`milan@centerforanthroposophy.org` and runs in **dry-run mode**.
It uses `openai/gpt-5.6-sol` at high reasoning to make a proposed edit in a temporary clone,
checks the complete diff, and runs the full Astro build. It then emails the result, but it
cannot commit or publish: no GitHub write credential is installed and both publish gates
are off.

## Intended live workflow

```
email → SendGrid webhook → authorize sender + scope → queue job → Sol edits temporary clone
      → deterministic checks → Astro build → commit to main → Render deploy → confirmation
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
- The worker is not given a GitHub credential during the dry-run pilot.
- Email can never edit `doorbell/**`, `.github/**`, package/build configuration, environment
  files, or OpenCode configuration.
- The PoC banner and `noindex` are checked in source and in the built homepage.
- Every future live change will be an attributed commit; history is never rewritten.
- Replies are signed `— Claude (CfA site doorbell)`, never as Sage.

## Implementation

The hosted implementation lives in the private SageRock `ask` repository under
`tools/_custom/cfa/`. This directory records CfA policy and the retired local prototype;
`run.sh` no longer processes mail.
