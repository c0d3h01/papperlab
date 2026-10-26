## Problem

What does this change fix or add? Link the issue if one exists.

## Approach

Why this design? Note any user-visible behavior, new setting or dependency.

## Checks

- [ ] `gofmt -w cmd internal scripts`
- [ ] `go vet ./...`
- [ ] `go test -race ./...`
- [ ] `go build ./...`
- [ ] Added or updated a focused test for behavior changes
- [ ] Updated docs, `.env.example` or `THIRD_PARTY_NOTICES.md` if needed
- [ ] No secrets, user documents or generated job data are included

## Risk

What could break for existing deployments? Mention migration, rollback or
security considerations.
