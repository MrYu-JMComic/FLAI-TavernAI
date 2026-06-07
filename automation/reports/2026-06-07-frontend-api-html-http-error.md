# 2026-06-07 Frontend API HTML HTTP Error

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Added focused frontend API coverage proving HTML-like HTTP error bodies do not become user-facing messages.
- Verified the thrown error falls back to the HTTP status message while still preserving the raw HTML response text for diagnostics.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 8/8.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 418/418.
- PASS: `npm.cmd run build` in `frontend`.
  - Encoding prebuild passed.
  - Frontend build passed.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed; scanned 375 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 418/418.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 375 files.

## Notes

- Product code did not need another change this run; this locks the existing HTML-body suppression behavior with direct coverage.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API test, backlog, and this report.
