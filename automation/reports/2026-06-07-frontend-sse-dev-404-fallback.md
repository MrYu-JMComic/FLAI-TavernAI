# 2026-06-07 Frontend SSE Dev 404 Fallback

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Tightened assistant SSE dev backend fallback handling so explicit structured 404 responses are preserved instead of being retried as missing Vite proxy responses.
- Added focused frontend API coverage proving a structured assistant SSE 404 error is thrown once without a second POST to the dev backend fallback.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 10/10.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 420/420.
- PASS: `npm.cmd run build` in `frontend`.
  - Encoding prebuild passed.
  - Frontend build passed.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed; scanned 377 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 420/420.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 377 files.

## Notes

- The fallback still applies to unstructured dev 404 responses, but no longer masks meaningful API errors or repeats a stream POST unnecessarily.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, its test, backlog, and this report.
