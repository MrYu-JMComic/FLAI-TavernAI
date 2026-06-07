# 2026-06-07 Frontend Nested CSRF Retry

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Updated frontend CSRF failure detection to reuse structured error extraction, including nested `error.message` payloads and raw text fallbacks.
- Added focused behavior coverage proving a JSON mutation retries after a nested CSRF error response and uses the refreshed token on the retry.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 4/4.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 414/414.
- PASS: `npm.cmd run build` in `frontend`.
  - Encoding prebuild passed.
  - Frontend build passed.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed; scanned 371 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 414/414.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 371 files.

## Notes

- This keeps CSRF retry detection aligned with the frontend API error-message parser, avoiding a separate brittle `String(error)` path.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the frontend API helper, its focused test, backlog, and this report.
