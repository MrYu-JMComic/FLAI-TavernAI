# 2026-06-07 Frontend SSE CSRF Clone-Free Retry

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Changed assistant SSE 403/419 handling to read the original response body for CSRF detection instead of relying on `response.clone()`.
- Reused the parsed 403/419 error detail for non-CSRF failures so the response body is not read twice.
- Added frontend API regression coverage proving assistant SSE CSRF retries still work when the original failed response cannot be cloned.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 16/16.
- PASS: `node scripts/check-encoding.mjs`.
  - Scanned 382 files; no common Chinese mojibake markers found.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic reported no unreviewed candidates.
  - Vue control accessibility diagnostic reported no inaccessible controls.
  - Backend tests passed: 426/426.
  - Frontend build passed.
  - Git status check reported the existing dirty worktree.

## Notes

- This is a narrow resilience fix for the recent frontend assistant SSE error-handling patches.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, frontend API tests, backlog, and this report.
