# CfA site doorbell — hosted worker policy

The active doorbell is the hosted `cfa-site@ask.sagerock.com` mailbox on SageRock's Ask
platform. SendGrid Inbound Parse triggers it directly; this repository no longer runs a
polling agent.

Current pilot:

- `sage@sagerock.com` and `milan@centerforanthroposophy.org` are authorized.
- Mailbox mode is `dry_run`.
- `CFA_SITE_PUBLISH_ENABLED=false`.
- No GitHub write credential is installed.
- Sol high may edit only a temporary clone; deterministic code validates the diff and build.

Live policy after explicit activation:

- An invited sender's unambiguous in-scope email is authorization to publish to `main`.
- Ambiguous, unauthorized, out-of-scope, conflicting, or failed-build requests do not publish.
- A clear UNDO reply creates a revert commit; history is never reset or force-pushed.
- Runtime scopes come only from Ask's encrypted mailbox config, never this repository.
- No email may modify `doorbell/**`, sender authority, infrastructure, package/build config,
  environment files, or the agent's own configuration.
- The PoC banner and `noindex` remain mandatory until CfA approves launch.
- Every reply is signed `— Claude (CfA site doorbell)`.

Implementation and operational state live in `/mnt/d/dev/ask` and its Railway services.
