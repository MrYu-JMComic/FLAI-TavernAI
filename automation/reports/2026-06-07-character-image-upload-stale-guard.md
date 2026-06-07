# Character Image Upload Stale Guard

Date: 2026-06-07

## Scope

Guarded character image panel uploads so an in-flight FileReader or create request from one character cannot refresh or write against a different character after the editor switches routes.

## Changed Files

- `frontend/src/components/CharacterImagePanel.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-character-image-upload-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 425 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 425 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 441/441.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 426 files.

## Notes

- Added an upload token that is invalidated whenever the panel switches `characterId`.
- Captured the upload's starting `characterId` and used it for create requests instead of reading live props after async FileReader work.
- Stale uploads now skip create/refresh/error notices after the panel has moved to another character.
- Kept the upload busy state active across a multi-file selection instead of flickering between files.

## Next Recommended Task

Review `CharacterImagePanel.vue` edit, default, delete, and drag reorder mutations for the same stale character-switch pattern.
