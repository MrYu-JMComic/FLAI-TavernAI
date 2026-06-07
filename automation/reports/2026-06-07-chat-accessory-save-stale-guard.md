# Chat Accessory Save Stale Guard

Date: 2026-06-07

## Scope

Guarded chat accessory skill saves so stale responses from an older conversation cannot update the active accessory skill state, show stale notices, or leave the save button stuck after navigation.

## Changed Files

- `frontend/src/composables/chat/useChatAccessory.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-accessory-save-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 420 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 420 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 438/438.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 420 files.

## Notes

- Added an accessory save token that must match before syncing saved skills, showing errors, showing success, or clearing save state.
- Added a second stale check after the follow-up economy refresh so navigation during the refresh cannot surface an old success notice.

## Next Recommended Task

Continue checking chat settings flows that save data and then call a follow-up refresh before updating user-facing state.
