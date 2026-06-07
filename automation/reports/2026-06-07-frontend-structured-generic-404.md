# 2026-06-07 Frontend Structured Generic 404

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Split retry-blocking checks so structured JSON errors always block dev-backend fallback, even when their message is a generic `Not Found`.
- Kept raw-text generic dev-server 404 bodies eligible for fallback.
- Added regression coverage for normal API and assistant SSE structured generic 404 responses.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 22/22.
- PASS: `node scripts/check-encoding.mjs`.
  - Scanned 387 files; no common Chinese mojibake markers found.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic reported no unreviewed candidates.
  - Vue control accessibility diagnostic reported no inaccessible controls.
  - Backend tests passed: 432/432.
  - Frontend build passed.
  - Git status check reported the existing dirty worktree.

## Notes

- This prevents API-shaped 404 responses from being mistaken for dev-server fallback text.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, frontend API tests, backlog, and this report.
