# CfA site doorbell — hosted worker policy

The active doorbell is the hosted `cfa-site@ask.sagerock.com` mailbox on SageRock's Ask
platform. SendGrid Inbound Parse triggers it directly; this repository no longer runs a
polling agent.

Current live pilot:

- `sage@sagerock.com` and `milan@centerforanthroposophy.org` have full-site scope;
  `elsy@centerforanthroposophy.org` has content-only scope under
  `src/content/posts/` for Center & Periphery and news updates.
- Mailbox mode is `live`.
- `CFA_SITE_PUBLISH_ENABLED=true`.
- Authorized JPEG/PNG/WebP attachments are optimized to a 2,400 px maximum long edge,
  stripped of metadata, converted to WebP, and uploaded to the fixed CfA S3 media prefix.
- `CFA_SITE_MEDIA_UPLOAD_ENABLED=true`; raw image bytes are never persisted in SQL or sent
  to the repository editor.
- A per-repository GitHub App supplies short-lived installation tokens; no personal token
  is installed on the worker.
- Sol high edits only a temporary clone; deterministic code validates the diff and build
  before a direct push to `main`.

Live policy:

- An invited sender's unambiguous in-scope email is authorization to publish to `main`.
- Ambiguous, unauthorized, out-of-scope, conflicting, or failed-build requests do not publish.
- A clear UNDO reply creates a revert commit; history is never reset or force-pushed.
- Runtime scopes come only from Ask's encrypted mailbox config, never this repository.
- No email may modify `doorbell/**`, sender authority, infrastructure, package/build config,
  environment files, or the agent's own configuration.
- SVG, GIF/animation, non-image attachments, images over 15 MB, images over 40 megapixels,
  and more than eight images in one request are rejected.
- The PoC banner and `noindex` remain mandatory until CfA approves launch.
- Every reply is signed `— Claude (CfA site doorbell)`.

Implementation and operational state live in `/mnt/d/dev/ask` and its Railway services.
