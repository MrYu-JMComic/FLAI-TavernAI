# 2026-06-07 Frontend SSE Nested Error Message

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Updated frontend structured error extraction so nested error payloads such as `{"error":{"message":"..."}}` use the nested message instead of stringifying to `[object Object]`.
- Added focused behavior coverage proving an assistant SSE error with a nested provider message becomes the thrown user-facing message.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 3/3.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 413/413.
- PASS: `npm.cmd run build` in `frontend`.
  - Encoding prebuild passed.
  - Frontend build passed.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed; scanned 370 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 413/413.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 370 files.

## Notes

- This is intentionally limited to structured frontend API error-message extraction; successful SSE and JSON response handling keep the existing parsing path.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the frontend API helper, its focused test, backlog, and this report.
