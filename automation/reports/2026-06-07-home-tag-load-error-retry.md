# 2026-06-07 Home Tag Load Error Retry

## Backlog Item

- Improve empty, loading, and error states in the Vue views.

## Changes

- Added a Home page tag-filter load error state instead of silently ignoring failed `fetchTags()` calls.
- Cleared stale tag options when tag loading fails so the visible filter rail cannot imply that refresh succeeded.
- Added an inline retry action using the existing `section-load-status` pattern.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 394 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 394 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 433/433.
  - Frontend production build passed.
  - Git status reported an existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 394 files.

## Notes

- The existing worktree already contained many unrelated modified and untracked files; this run intentionally touched only `frontend/src/views/HomeView.vue`, `automation/backlog.md`, and this report.
