# 2026-06-07 Home Hot Tags Random Limit

## Goal

Refine the home page tag rail so it only shows popular tags, exposes the current maximum display count, and rotates a random subset of popular tags when there are too many to fit.

## Changes

- Filtered the home tag rail to tags with `usageCount > 0`.
- Added a responsive maximum display count based on the home page content width.
- Added a per-entry random seed so overflowing popular tags rotate each time the home page is mounted.
- Added a visible summary such as `显示 4/7，最多 4 个`.
- Removed horizontal scrolling from the tag rail and constrained long tag labels with ellipsis.

## Files Touched

- `frontend/src/views/HomeView.vue`
- `frontend/src/styles.css`

## Validation

- `frontend`: `npm.cmd run build` passed.
- `root`: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed.

## Notes

- Existing unrelated worktree changes were left untouched.
