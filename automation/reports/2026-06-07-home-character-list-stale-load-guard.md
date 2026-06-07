# 2026-06-07 Home Character List Stale Load Guard

## Backlog Item

- Improve empty, loading, and error states in the Vue views.

## Changes

- Added a request token guard to Home page character list loading.
- Captured search, sort, and tag filters at request start so fast filter changes cannot be overwritten by older responses.
- Kept stale responses from changing the visible character list, load error, or loading state.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 399 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 399 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 435/435.
  - Frontend production build passed.
  - Git status reported an existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 399 files.

## Notes

- The existing worktree already contained many unrelated modified and untracked files; this run intentionally touched only `frontend/src/views/HomeView.vue`, `automation/backlog.md`, and this report.
