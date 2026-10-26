# PaperLab

PaperLab is an independent, open-source PDF workshop: a Go API and a static, vanilla-JS front end with 41 document tools. It is not affiliated with iLovePDF or any other PDF brand.

## What is included

- Organise: merge, split, remove pages, extract pages, organise, rotate, crop, N-up, booklet.
- Optimise: compress, repair, OCR, PDF/A, flatten.
- Convert: PDF to Word/PowerPoint/Excel/JPG, and Word/PowerPoint/Excel/JPG/HTML to PDF.
- Edit: edit, sign, redact, watermark, page numbers.
- Security: protect, unlock, compare.
- Forms: fill, extract form data.
- Intelligence: summarise, chat with PDF, translate.

The UI also has a visual Studio (edit, sign, organise, redact, crop) and a grounded Chat view. Uploads are asynchronous: create a job, poll it, then download outputs. Jobs and files expire automatically.

## Requirements

- Go 1.27+
- Poppler (`pdftoppm`, `pdftotext`, `pdfinfo`)
- Ghostscript
- qpdf
- Tesseract (optional, for OCR)
- LibreOffice (optional, for high-fidelity Office conversion)
- Chromium/Chrome (optional, for HTML/URL to PDF)

The API reports missing optional engines as unavailable.

## Run locally

```sh
cp .env.example .env
set -a; . ./.env; set +a
go build -o bin/paperlab ./cmd/server
./bin/paperlab
```

Open <http://localhost:8080>. The API health check is at `/api/health`.

The Go binary does not parse `.env` itself. Export it as shown above, or pass variables inline.

## Docker

The image includes all engines and is the full-fidelity way to run the project:

```sh
cp .env.example .env
docker compose up --build
```

Open <http://localhost:8080>. Jobs are stored in the `paperlab-data` volume. The image runs as an unprivileged user and contains Poppler, Ghostscript, qpdf, Tesseract, LibreOffice, Chromium and the fonts used by conversions.

## Configuration

`.env.example` documents the available settings. Copy it to `.env`; the real `.env` is ignored by git.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAPERLAB_ADDR` | `:8080` | Listen address. |
| `PAPERLAB_SERVE_WEB` | `true` | Serve `web/` from Gin. |
| `PAPERLAB_WEB_DIR` | `web` | Static front-end directory. |
| `PAPERLAB_DATA_DIR` | temp dir | Job staging and output storage. |
| `PAPERLAB_MAX_UPLOAD_MB` | `250` | Upload limit. |
| `PAPERLAB_MAX_FILES` | `30` | Files per job. |
| `PAPERLAB_JOB_TTL_MIN` | `120` | Time before job files are removed. |
| `PAPERLAB_JOB_TIMEOUT_MIN` | `20` | Processing timeout. |
| `PAPERLAB_API_KEY` | empty | Optional `X-API-Key` / Bearer token. |
| `PAPERLAB_CORS_ORIGINS` | `*` | Comma-separated allowed front-end origins. |
| `PAPERLAB_TRUSTED_PROXIES` | empty | IPs/CIDRs of reverse proxies allowed to set `X-Forwarded-For`. |
| `PAPERLAB_RATE_LIMIT_PER_MIN` | `240` | Per-IP request limit. |
| `PAPERLAB_ALLOW_LOCAL_URLS` | `false` | Allow HTML-to-PDF to fetch private/local URLs. |
| `PAPERLAB_AI_BASE_URL` | empty | OpenAI-compatible API base URL. |
| `PAPERLAB_AI_API_KEY` | empty | AI provider key. |
| `PAPERLAB_AI_MODEL` | `gpt-4o-mini` | AI model name. |
| `PAPERLAB_LIBRETRANSLATE_URL` | empty | LibreTranslate base URL. |

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

## Front end

`web/` is plain ES modules with no build step. Gin serves it when `PAPERLAB_SERVE_WEB=1`. To serve it from a different origin, set the API origin in `web/assets/js/config.js`, with `?api=https://...`, or in `localStorage.paperlab_api`. If the API requires a key, store it in `localStorage.paperlab_api_key`.

## Checks

```sh
gofmt -l cmd internal scripts
go vet ./...
go test -race ./...
go build ./...
```

The Docker image is the full-fidelity target because it includes LibreOffice and Chromium; a bare Go install may report those engines as unavailable.

## Contributing

Bug reports, tests, documentation and focused pull requests are welcome. Open an issue for a large change first, keep the change focused, and run the checks above. By contributing, you agree that your contribution is licensed under Apache-2.0.

Security problems should be reported privately through GitHub's Security tab rather than a public issue.

## License

PaperLab is licensed under the Apache License 2.0. The full text is in `LICENSE`; attribution notices are in `NOTICE`. Third-party components, including the bundled fonts, PDF.js and the Go modules, are listed in `THIRD_PARTY_NOTICES.md`. The Docker image also contains Ghostscript (AGPL-3.0), Poppler (GPL-2.0), LibreOffice (MPL-2.0), Tesseract, qpdf and Chromium; see that file before redistributing the image.

PaperLab is an independent project and is not affiliated with iLovePDF or any other PDF brand.
