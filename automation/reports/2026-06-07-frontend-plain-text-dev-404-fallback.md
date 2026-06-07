# 2026-06-07 Frontend Plain Text Dev 404 Fallback

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Updated dev backend fallback checks to treat readable plain-text 404 response bodies as real API errors, matching the existing structured error behavior.
- Reused the readable error extraction path for CSRF detection so structured and plain text messages stay consistent.
- Added focused frontend API coverage for plain-text 404 responses on both normal JSON requests and assistant SSE requests.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 13/13.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 423/423.
- PASS: `npm.cmd run build` in `frontend`.
  - Encoding prebuild passed.
  - Frontend build passed.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed; scanned 379 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 423/423.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 379 files.

## Notes

- HTML-like 404 bodies still do not block the dev backend fallback because they are filtered out of readable raw error text.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, its test, backlog, and this report.
