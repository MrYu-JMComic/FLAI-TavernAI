# 2026-06-07 Frontend API Unreadable Error Body

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Added a shared response body reader that preserves HTTP error status when a non-OK response body cannot be read.
- Reused the shared reader for normal JSON API requests and assistant SSE dev fallback checks.
- Added regression coverage proving normal API dev fallback is blocked when the initial 404 response body cannot be read.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 20/20.
- PASS: `node scripts/check-encoding.mjs`.
  - Scanned 386 files; no common Chinese mojibake markers found.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic reported no unreviewed candidates.
  - Vue control accessibility diagnostic reported no inaccessible controls.
  - Backend tests passed: 430/430.
  - Frontend build passed.
  - Git status check reported the existing dirty worktree.

## Notes

- This aligns normal API behavior with the recent assistant SSE unreadable-body guard.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, frontend API tests, backlog, and this report.
