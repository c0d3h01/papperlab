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

Run the full stack:

```sh
go build -o bin/paperlab ./cmd/server
PAPERLAB_DATA_DIR=/tmp/paperlab PAPERLAB_SERVE_WEB=1 ./bin/paperlab
```

Open <http://localhost:8080>. The API health check is at `/api/health`.

Or use Docker Compose, which installs all engines and serves the web UI:

```sh
docker compose up --build
```

## Deployment

### 1. API container

Build and run the API image:

```sh
docker build -t paperlab-api .
docker run --rm -p 8080:8080 \
  -e PAPERLAB_SERVE_WEB=0 \
  -e PAPERLAB_CORS_ORIGINS=https://paperlab.pages.dev \
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

For a quick test, `cloudflared tunnel --url http://127.0.0.1:8080` prints a temporary public URL. Cloudflare Containers is an alternative if you want Cloudflare to run the container itself; keep the same container port and health endpoint.

## Configuration

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
go build ./...
go vet ./...
```

The API smoke checks used during development exercise the tools with `testdata/sample.pdf`, `testdata/form.pdf`, and the Office/image fixtures. The Docker image is the full-fidelity target because it includes LibreOffice and Chromium; a bare local Go install may report those engines as unavailable.

## Privacy and safety

Files are written to a private per-job directory and removed after the configured TTL. There is no account system or database. Redaction rasterises affected pages so text is not left underneath the black boxes. Signing adds an electronic signature and an audit JSON file; it is not a qualified digital certificate.
