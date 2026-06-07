# 2026-06-07 Frontend API Fallback Refactor

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Refactored clustered frontend API dev fallback logic to separate retry-base lookup from retry-blocking error detection.
- Reused the computed fallback base for normal API requests and assistant SSE requests instead of recomputing the backend base after deciding to retry.
- Preserved existing structured, plain-text, generic dev 404, CSRF retry, and SSE error behavior under focused coverage.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 15/15.
- PASS: `node scripts/check-encoding.mjs`.
  - Scanned 381 files; no common Chinese mojibake markers found.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic reported no unreviewed candidates.
  - Vue control accessibility diagnostic reported no inaccessible controls.
  - Backend tests passed: 425/425.
  - Frontend build passed.
  - Git status check reported the existing dirty worktree.

## Notes

- This is a maintenance refactor of the recent fallback patches rather than a product-surface change.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, backlog, and this report.
