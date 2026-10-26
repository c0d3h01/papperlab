# PaperLab

PaperLab is an independent PDF workshop: a Go API and a static, vanilla-JS front end with 41 document tools. It is not affiliated with iLovePDF or any other PDF brand.

The front end is deployed to Cloudflare Pages. The processing API is a container (Gin + document engines) exposed through Cloudflare Tunnel or Cloudflare Containers, because a Go/Gin process cannot run directly on Workers.

## What is included

- Organise: merge, split, remove pages, extract pages, organise, rotate, crop, N-up, booklet.
- Optimise: compress, repair, OCR, PDF/A, flatten.
- Convert: PDF to Word/PowerPoint/Excel/JPG, and Word/PowerPoint/Excel/JPG/HTML to PDF.
- Edit: edit, sign, redact, watermark, page numbers.
- Security: protect, unlock, compare.
- Forms: fill, extract form data.
- Intelligence: summarise, chat with PDF, translate.

The UI also has a visual Studio (edit, sign, organise, redact, crop) and a grounded Chat view. Uploads are asynchronous: create a job, poll it, then download outputs. Jobs and files expire automatically.

## Local development

Requirements:

- Go 1.27+
- Poppler (`pdftoppm`, `pdftotext`, `pdfinfo`)
- Ghostscript
- qpdf
- Tesseract (optional, for OCR)
- LibreOffice (optional, for high-fidelity Office conversion)
- Chromium/Chrome (optional, for HTML/URL to PDF)

Copy the example environment and load it into the shell:

```sh
cp .env.example .env
set -a; . ./.env; set +a
go build -o bin/paperlab ./cmd/server
./bin/paperlab
```

Open <http://localhost:8080>. The API health check is at `/api/health`.

Or use Docker Compose, which installs all engines, reads `.env`, and serves the web UI:

```sh
cp .env.example .env
docker compose up --build
```

The Go binary does not parse `.env` itself. Export it as shown above, or pass variables inline.

## Deployment

### 1. API container

Build and run the API image:

```sh
docker build -t paperlab-api .
cp .env.production .env
# Edit .env: set PAPERLAB_CORS_ORIGINS, PAPERLAB_API_KEY and any AI keys.
docker run --rm -p 127.0.0.1:8080:8080 --env-file .env \
  -v paperlab-data:/data \
  paperlab-api
```

The image contains Poppler, Ghostscript, qpdf, Tesseract, LibreOffice, Chromium and the fonts used by conversions. It runs as an unprivileged user and stores jobs in `/data`.

For a local full-stack container, set `PAPERLAB_SERVE_WEB=1` and open port 8080.

### 2. Cloudflare Pages front end

The front end has no build step. Set the API origin in `web/assets/js/config.js` before deploying:

```js
window.PAPERLAB_API = "https://api.paperlab.example";
```

Deploy the `web` directory:

```sh
npx wrangler pages deploy web --project-name paperlab
```

In the Pages project, use `web` as the output directory if you connect a Git repository. `web/_redirects` provides clean URLs and `web/_headers` sets security and cache headers.

The API origin can also be supplied per browser with `?api=https://api.example` or:

```js
localStorage.setItem("paperlab_api", "https://api.example");
```

If `PAPERLAB_API_KEY` is set on the API, store the key in the browser:

```js
localStorage.setItem("paperlab_api_key", "the-key");
```

Use a Pages custom domain and set `PAPERLAB_CORS_ORIGINS` to that exact origin. The default CORS policy is `*`, which is convenient for a local trial but should be narrowed in production.

### 3. Expose the API through Cloudflare Tunnel

For a persistent named tunnel, create one in the Cloudflare dashboard and add a configuration like:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /etc/cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: api.paperlab.example
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Route DNS and run it:

```sh
cloudflared tunnel route dns paperlab-api api.paperlab.example
cloudflared tunnel run paperlab-api
```

For a quick test, `cloudflared tunnel --url http://127.0.0.1:8080` prints a temporary public URL. Cloudflare Containers requires the Workers Paid plan ($5/month minimum) and is not part of the free path; it also needs a Worker wrapper and does not provide the persistent local disk this app uses.

Set `PAPERLAB_TRUSTED_PROXIES` to the address the API sees cloudflared connecting from, so rate limiting reads the real client IP from `X-Forwarded-For`. With the binary running directly on the host that is `127.0.0.1`. With Docker it is the bridge gateway, not loopback; find it with `docker compose exec api sh -c 'ip route | awk "/default/ {print \$3}"'` (usually `172.x.0.1`). If cloudflared runs in the same Compose network, use that network's subnet CIDR instead. Leave it empty when the API is directly exposed. Also keep an egress firewall in front of the container if users can submit arbitrary HTML or URLs: HTML-to-PDF is an outbound fetch primitive, and `PAPERLAB_ALLOW_LOCAL_URLS=false` only blocks the initial URL and redirects, not every subresource Chrome may request.

### Free-always deployment

Cloudflare Pages and Cloudflare Tunnel are free. The API needs native PDF engines, a writable data directory and jobs longer than a Worker invocation, so it must run in a container or VM. For a $0 deployment, run the container on an always-on machine and expose only the tunnel:

- **Oracle Cloud Always Free** Ampere A1 instance (2 OCPU / 12 GB RAM, 200 GB storage as of 2026). This is the only free tier with enough memory for LibreOffice and Chromium. Oracle may reclaim an instance that stays below 20% CPU, network and memory utilisation over 7 days, so keep backups and treat it as reclaimable.
- **An always-on home server or NAS** with Docker. Uptime is then your responsibility.

Bind the API to `127.0.0.1:8080` and let cloudflared reach it from the same host. Do not open port 8080 in the VM firewall or Oracle security list. Set `PAPERLAB_TRUSTED_PROXIES` to the Docker bridge gateway as described above, otherwise every visitor shares one rate-limit bucket. Keep `PAPERLAB_MAX_UPLOAD_MB` at or below 100: Cloudflare's free proxy accepts at most 100 MB per request and waits 100 seconds for an origin response. The async job model keeps processing off the request path, but very slow uploads or large downloads can still hit those limits.

The front end stays on Pages and the API gets a stable hostname such as `api.paperlab.example`; Cloudflare Tunnel requires a domain in a Cloudflare zone. A quick `trycloudflare.com` tunnel is fine for testing but changes URL on restart and has no uptime guarantee.

## Configuration

`.env.example` is the local template and `.env.production` is the production template. Copy either to `.env`; the real `.env` is ignored by git, so keys never belong in the templates.

For a split Pages deployment, start from `.env.production`, set `PAPERLAB_CORS_ORIGINS` to the Pages origin, and set `PAPERLAB_API_KEY` to a long random value if the API is public. Store the same key in the browser as `localStorage.paperlab_api_key`. Behind Cloudflare, keep `PAPERLAB_MAX_UPLOAD_MB` at or below 100 unless your plan raises the request-body limit.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAPERLAB_ADDR` | `:8080` | Listen address. |
| `PAPERLAB_SERVE_WEB` | `true` | Serve `web/` from Gin. Set to `false` for the Pages deployment. |
| `PAPERLAB_WEB_DIR` | `web` | Static front-end directory. |
| `PAPERLAB_DATA_DIR` | temp dir | Job staging and output storage. |
| `PAPERLAB_MAX_UPLOAD_MB` | `250` | Upload limit. |
| `PAPERLAB_MAX_FILES` | `30` | Files per job. |
| `PAPERLAB_JOB_TTL_MIN` | `120` | Time before job files are removed. |
| `PAPERLAB_JOB_TIMEOUT_MIN` | `20` | Processing timeout. |
| `PAPERLAB_API_KEY` | empty | Optional `X-API-Key` / Bearer token. |
| `PAPERLAB_CORS_ORIGINS` | `*` | Comma-separated allowed front-end origins. |
| `PAPERLAB_TRUSTED_PROXIES` | empty | IPs/CIDRs of reverse proxies allowed to set `X-Forwarded-For`. Set this behind Cloudflare Tunnel so rate limits use real client IPs. |
| `PAPERLAB_RATE_LIMIT_PER_MIN` | `240` | Per-IP request limit. |
| `PAPERLAB_CHROME_PATH` | auto | Chromium/Chrome executable. |
| `PAPERLAB_LIBREOFFICE_PATH` | auto | LibreOffice executable. |
| `PAPERLAB_AI_BASE_URL` | empty | OpenAI-compatible API base URL. |
| `PAPERLAB_AI_API_KEY` | empty | AI provider key. |
| `PAPERLAB_AI_MODEL` | `gpt-4o-mini` | AI model name. |
| `PAPERLAB_LIBRETRANSLATE_URL` | empty | LibreTranslate base URL. |
| `PAPERLAB_ALLOW_LOCAL_URLS` | `false` | Allow HTML-to-PDF to fetch private/local URLs. Leave off in production. |

Without an AI provider, summaries and chat answers use local extraction and retrieval. Without LibreOffice, Office files use the built-in native fallbacks. Translation requires an AI provider or LibreTranslate; otherwise the tool is reported as unavailable.

## API

- `POST /api/jobs` — multipart `files`, optional `assets`, `tool`, and JSON `options`; returns a job.
- `GET /api/jobs/:id` — status, metadata and output list.
- `GET /api/jobs/:id/files/:fileID` — download an output.
- `DELETE /api/jobs/:id` — delete a job.
- `GET /api/tools` — tool inventory and availability.
- `GET /api/config` — public limits and engine availability.
- `GET /api/health` — health and engine versions.
- `POST /api/inspect/pdf`, `POST /api/inspect/forms`, `POST /api/analyze/redact`, `POST /api/chat` — interactive helpers.

## Verification

```sh
gofmt -l cmd internal scripts
go vet ./...
go test -race ./...
go build ./...
```

The API smoke checks used during development exercise the tools with `testdata/sample.pdf`, `testdata/form.pdf`, and the Office/image fixtures. The Docker image is the full-fidelity target because it includes LibreOffice and Chromium; a bare local Go install may report those engines as unavailable.

## Privacy and safety

Files are written to a private per-job directory and removed after the configured TTL. There is no account system or database. Redaction rasterises affected pages so text is not left underneath the black boxes. Signing adds an electronic signature and an audit JSON file; it is not a qualified digital certificate.

PaperLab is not a hard multi-tenant sandbox. The native PDF engines run as separate processes under an unprivileged container user, but they are not individually sandboxed. Set `PAPERLAB_API_KEY`, narrow `PAPERLAB_CORS_ORIGINS`, keep `PAPERLAB_ALLOW_LOCAL_URLS=false`, and put an egress firewall in front of the API before exposing it to untrusted users. See `SECURITY.md` for the full threat model and deployment checklist.

## Contributing

Bug reports, tests, documentation and focused code changes are welcome. Read `CONTRIBUTING.md` before opening a pull request. By contributing, you agree that your contribution is licensed under Apache-2.0.

Security problems should be reported privately as described in `SECURITY.md`, not in a public issue.

## License

PaperLab is licensed under the Apache License 2.0. The full text is in `LICENSE`; attribution notices are in `NOTICE`. Third-party components, including the bundled fonts, PDF.js and the Go modules, are listed in `THIRD_PARTY_NOTICES.md`. The Docker image also contains Ghostscript (AGPL-3.0), Poppler (GPL-2.0), LibreOffice (MPL-2.0), Tesseract, qpdf and Chromium; see that file before republishing the image.

PaperLab is an independent project and is not affiliated with iLovePDF or any other PDF brand.
