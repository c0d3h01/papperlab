# Security policy

## Supported versions

PaperLab is maintained on the `main` branch. Security fixes are applied there
and in the latest tagged release, if one exists. Older snapshots are not
supported.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected version or commit, a description, reproduction steps,
   and any proof of concept.

If private reporting is unavailable, contact a maintainer directly through
GitHub and ask for a private channel. Do not send secrets or user documents in
the first message.

Reports are handled on a best-effort basis. You will get an acknowledgement
when a maintainer has seen the report, and an update when a fix or mitigation
is available. Please give maintainers time to release a fix before publishing
details.

## Threat model

PaperLab processes untrusted files with native engines. It is designed for a
single trusted operator, not as a hard multi-tenant sandbox. Important
assumptions:

- Uploaded documents, filenames and extracted text are untrusted input.
- The container user is unprivileged, but the PDF engines are not separately
  sandboxed. A memory-safety bug in Ghostscript, Poppler, LibreOffice,
  Tesseract, Chromium or a Go parser is in scope for the deployment, not
  something PaperLab can fully contain.
- Jobs are stored on local disk. The API is stateful and must not be scaled
  across instances without sticky routing or shared storage.
- With no `PAPERLAB_API_KEY`, every endpoint that can be reached is public.
  Set a key and narrow `PAPERLAB_CORS_ORIGINS` before exposing the API.
- HTML-to-PDF is an outbound fetch primitive. `PAPERLAB_ALLOW_LOCAL_URLS=false`
  blocks URLs that resolve to loopback, private, link-local and other
  non-public addresses. The check runs before Chrome loads the page and again
  after redirects, but Chrome resolves hosts itself. A DNS-rebinding host, or a
  remote subresource embedded in uploaded HTML, can still reach the local
  network. Run the API behind an egress firewall that denies private ranges.
- Rate limiting is in memory and per instance. Behind Cloudflare Tunnel or a
  reverse proxy, set `PAPERLAB_TRUSTED_PROXIES` to the proxy address so the
  limiter uses the real client IP instead of putting every user in one bucket.
- Upload size, file count, page count and image dimensions are capped. These
  limits reduce accidental load; they are not a substitute for a request
  timeout at the edge.

## Deployment checklist

- Set `PAPERLAB_API_KEY` to a long random value and store it only in the
  browser's `localStorage.paperlab_api_key`.
- Set `PAPERLAB_CORS_ORIGINS` to the exact Pages or custom-domain origin.
- Set `PAPERLAB_TRUSTED_PROXIES` to the tunnel/proxy address, or leave it empty
  when the API is directly exposed.
- Keep `PAPERLAB_ALLOW_LOCAL_URLS=false` unless private fetches are required.
- Run the container as the provided unprivileged user with a persistent
  `/data` volume and a disk quota.
- Put an egress firewall or proxy in front of the container if users can
  submit arbitrary HTML or URLs.
- Keep the base image, Debian packages and Go modules patched. Dependabot is
  configured for Go modules, GitHub Actions and Docker.
- Do not put secrets in `.env.example` or `.env.production`; both are tracked.

## Known limitations

- No qualified digital signature. The signing tool adds an electronic signature
  and an audit record, not a certificate-backed signature.
- No multi-tenant isolation beyond per-job directories and the container user.
- No virus scanning. Treat every output as potentially malicious.
- AI features send document excerpts to the configured provider when
  `PAPERLAB_AI_BASE_URL` is set. Leave it empty for local-only extraction.
