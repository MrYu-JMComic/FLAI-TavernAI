# Chat Status Bar Delete Stale Guard

Date: 2026-06-07

## Scope

Guarded chat status bar deletion so delete responses from an older conversation cannot clear the currently active status bar state, and overlapping save/delete mutations cannot race each other.

## Changed Files

- `frontend/src/composables/chat/useChatAccessory.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-statusbar-delete-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 417 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 417 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 438/438.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 417 files.

## Notes

- Renamed the status bar save token to a shared mutation token for save and delete actions.
- Captured the conversation id before deletion and ignored stale responses or errors after conversation changes.
- Reused the existing status bar saving guard to block delete while a status bar mutation is already running.

## Next Recommended Task

Continue checking chat settings save and delete flows for shared mutation state where overlapping requests can write the same UI state.
