# 2026-06-07 Frontend SSE Dev Fallback Unreadable Body

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Added a retry-check response reader that converts unreadable 404 bodies into a blocking HTTP error detail.
- Used that reader for assistant SSE dev-backend fallback checks so an unreadable initial 404 body no longer triggers speculative fallback to the backend port.
- Added regression coverage proving assistant SSE dev fallback is blocked when the initial 404 response body cannot be read.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 19/19.
- PASS: `node scripts/check-encoding.mjs`.
  - Scanned 385 files; no common Chinese mojibake markers found.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic reported no unreviewed candidates.
  - Vue control accessibility diagnostic reported no inaccessible controls.
  - Backend tests passed: 429/429.
  - Frontend build passed.
  - Git status check reported the existing dirty worktree.

## Notes

- This keeps the recent dev fallback logic conservative when the client cannot inspect the original 404 response.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, frontend API tests, backlog, and this report.
