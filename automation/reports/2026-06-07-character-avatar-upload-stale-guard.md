# Character Avatar Upload Stale Guard

Date: 2026-06-07

## Scope

Guarded character avatar uploads so a slower FileReader result from an older pick cannot overwrite a newer selected avatar.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-character-avatar-upload-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 424 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 424 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 441/441.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 425 files.

## Notes

- Added an avatar upload token to ignore stale FileReader results after a newer avatar file is selected.
- Cleared the file input value after each pick so selecting the same file again still triggers a change event.
- Added warning handling for avatar read failures instead of letting the async handler surface an unhandled rejection.

## Next Recommended Task

Review `CharacterImagePanel.vue` upload and reorder flows for stale async upload or stale list refresh patterns.
