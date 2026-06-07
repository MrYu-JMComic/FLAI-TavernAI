# 2026-06-07 Character Form Option Load Error

## Backlog Item

- Improve empty, loading, and error states in the Vue views.

## Changes

- Added independent `optionsLoading` and `optionsLoadError` state for character form tag/world-book choices.
- Replaced the silent tag/world-book option load catch with an inline error message and retry action.
- Prevented the world-book selector from showing a false "no world books" empty state when options failed to load.
- Kept tag entry usable during option-load failures while explaining that existing tags and world books require a retry.
- Started edit-mode character loading in parallel with option loading so slow auxiliary lists do not delay the main edit form load.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 391 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 392 files.
  - Unreferenced Vue component diagnostic reported no unreviewed candidates.
  - Vue control accessibility diagnostic reported no inaccessible controls.
  - Backend tests passed: 433/433.
  - Frontend build passed.
  - Git status check reported the existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs` after this report was updated.
  - Encoding check passed: scanned 392 files.

## Notes

- The existing worktree already contained many unrelated modified and untracked files; this run intentionally touched only `frontend/src/views/CharacterFormView.vue`, `automation/backlog.md`, and this report.
