# Chat Background Upload Stale Guard

Date: 2026-06-07

## Scope

Guarded chat background image uploads so slower FileReader results from an older selection cannot overwrite a newer selected or cleared background field.

## Changed Files

- `frontend/src/composables/chat/useChatAppearance.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-background-upload-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 421 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 421 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 438/438.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 421 files.

## Notes

- Added per-field background upload tokens for desktop and mobile background reads.
- Clearing a background now invalidates any pending read for that field, so an older read cannot restore a cleared image.
- Stale read errors are ignored to avoid surfacing warnings for a file selection the user has already replaced.

## Next Recommended Task

Check other asynchronous local file reads, especially character form background uploads, for the same stale FileReader overwrite pattern.
