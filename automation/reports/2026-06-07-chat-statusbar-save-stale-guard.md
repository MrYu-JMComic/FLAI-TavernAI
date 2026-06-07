# Chat Status Bar Save Stale Guard

Date: 2026-06-07

## Scope

Guarded chat status bar saves so a save response from an older conversation cannot overwrite the currently active conversation state, and an older save cannot clear the saving state for a newer save.

## Changed Files

- `frontend/src/composables/chat/useChatAccessory.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-statusbar-save-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 415 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 415 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 438/438.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 415 files.

## Notes

- Captured the conversation id before saving and reused it for the API request.
- Added a status bar save token so only the latest save may write status bar state, show errors, or clear the saving flag.

## Next Recommended Task

Continue checking chat settings actions for stale-response protection, especially destructive actions that share state with save flows.
