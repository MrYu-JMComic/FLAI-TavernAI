# 2026-06-07 Frontend SSE Plain Text Error

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Preserved raw SSE data text on parsed frontend events.
- Updated the assistant SSE error path to use that raw text as a fallback when structured JSON `error` or `message` fields are unavailable.
- Added focused behavior coverage proving a plain-text SSE error payload becomes the thrown user-facing message.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 2/2.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 412/412.
- PASS: `npm.cmd run build` in `frontend`.
  - Encoding prebuild passed.
  - Frontend build passed.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed; scanned 369 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 412/412.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 369 files.

## Notes

- JSON SSE event data still flows through the existing `safeJson` path; the raw text is only used as an error-message fallback.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the frontend API parser, its focused test, backlog, and this report.
