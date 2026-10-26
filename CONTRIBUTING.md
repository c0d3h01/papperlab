# Contributing to PaperLab

Thanks for helping. PaperLab is a small Go API plus a static vanilla-JS front
end. Contributions of bug reports, documentation, tests and focused code
changes are welcome.

By submitting a contribution you agree that it is licensed under the
Apache License 2.0, the same license as the project. There is no separate CLA.

## Before you start

- Open an issue for a large change or a new tool so the approach can be agreed
  before you write it.
- Report security problems privately as described in `SECURITY.md`, not in a
  public issue.
- Keep a change focused. Do not mix refactors, formatting-only edits and new
  features in one pull request.

## Development setup

Requirements:

- Go 1.27 or newer.
- Poppler, Ghostscript and qpdf for the core PDF tools.
- Tesseract for OCR, LibreOffice for Office conversion, and Chromium for
  HTML-to-PDF. These are optional; the API reports unavailable tools when the
  engine is missing.

```sh
cp .env.example .env
set -a; . ./.env; set +a
go build -o bin/paperlab ./cmd/server
./bin/paperlab
```

Open <http://localhost:8080>. The API health check is `/api/health`.

The front end has no build step. It is plain ES modules under `web/`, and
`web/_headers` and `web/_redirects` are the Cloudflare Pages configuration.

## Checks

Run these before opening a pull request:

```sh
gofmt -w cmd internal scripts
go vet ./...
go test -race ./...
go build ./...
```

Add a focused test when you change behavior, especially for parsing, page
selection, URL handling, file limits or security middleware. Tests must not
require network access or optional engines.

## Code style

- Follow the structure and naming already in the package.
- Prefer the standard library and existing helpers over new dependencies.
- Keep tool implementations in `internal/tools` and register them with
  `Register`.
- User-facing errors should say what the person can do next. Do not include
  secrets or full filesystem paths.
- Front-end code is framework-free ES modules. Keep DOM text in `textContent`
  or the existing `h()` helper; do not inject untrusted strings as HTML.
- Do not commit `.env`, keys, generated job data or large test fixtures.

## Pull requests

A good pull request:

- explains the problem and the chosen fix;
- lists the user-visible behavior change;
- includes the checks you ran;
- updates `README.md`, `.env.example` or `THIRD_PARTY_NOTICES.md` when the
  change adds a setting, dependency or license obligation.

Maintainers may ask for a smaller change or a test before merging. Be patient;
this is a volunteer project.
