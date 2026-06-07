# 2026-06-07 Frontend SSE Dev Fallback Clone-Free

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Changed assistant SSE dev-backend fallback checks to read the original 404 response body instead of relying on `response.clone()`.
- Reused the parsed 404 error detail when fallback is blocked so structured errors are not lost after the response body is consumed.
- Removed the now-unused cloned response body reader helper from the frontend API module.
- Added regression coverage proving structured assistant SSE 404 errors are preserved when the response cannot be cloned.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 18/18.
- PASS: `node scripts/check-encoding.mjs`.
  - Scanned 384 files; no common Chinese mojibake markers found.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic reported no unreviewed candidates.
  - Vue control accessibility diagnostic reported no inaccessible controls.
  - Backend tests passed: 428/428.
  - Frontend build passed.
  - Git status check reported the existing dirty worktree.

## Notes

- This continues the recent frontend assistant SSE cleanup by removing another clone-dependent edge case.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, frontend API tests, backlog, and this report.
