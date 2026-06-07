# Character Form Background Upload Stale Guard

Date: 2026-06-07

## Scope

Guarded character form advanced background image uploads so a slower FileReader result from an older pick cannot restore a background after the user clears or replaces that field.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-character-form-background-upload-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 422 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 422 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 441/441.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 423 files.

## Notes

- Added per-field upload tokens for desktop and mobile character background reads.
- Clearing a background now invalidates the pending read and clears the local uploading state immediately.
- Stale read results and stale read errors are ignored, so older asynchronous FileReader callbacks cannot overwrite newer user intent.

## Next Recommended Task

Review other file input handlers, especially avatar and character image upload paths, for the same stale asynchronous read or stale request pattern.
