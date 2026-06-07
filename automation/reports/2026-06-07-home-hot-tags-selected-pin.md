# 2026-06-07 Home Hot Tags Selected Pin

## Goal

Keep the Home tag rail visually in sync with the active tag filter when the rail is limited, randomized, or recalculated after layout changes.

## Changes

- Added `selectedHotTag` so the current tag filter can be matched against the latest loaded tag list.
- Pinned the selected tag back into the visible hot-tag rail when randomization, responsive limits, or refreshed usage counts would otherwise hide it.
- Kept the hot-tag summary count coherent when the selected tag is outside the popular-tag set.

## Files Touched

- `frontend/src/views/HomeView.vue`
- `automation/backlog.md`

## Validation

- `root`: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed.

## Notes

- Existing unrelated worktree changes and untracked viewport reports/tests were left untouched.
