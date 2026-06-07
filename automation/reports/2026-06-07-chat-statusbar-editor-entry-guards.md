# 2026-06-07 Chat Status-Bar Editor Entry Guards

## Goal

Keep ChatSettingsDrawer status-bar editor mutations aligned with the visible saving lock, including programmatic events that bypass disabled controls.

## Changes

- Added one shared `isStatusBarEditorLocked()` guard in the chat accessory composable.
- Guarded status-bar editor open/close, template-mode changes, status variables, immersive character rows, character variables, and quick replies while `statusBarSaving` is true.
- Added focused composable behavior coverage proving editor entry points do not mutate the status-bar draft during a pending save.

## Files Touched

- `frontend/src/composables/chat/useChatAccessory.js`
- `backend/src/tests/frontendChatAccessory.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatAccessory.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 473 backend tests and the frontend build.

## Notes

- This complements the existing disabled fieldset in `ChatSettingsDrawer.vue` without adding per-control template conditions.
- Existing dirty worktree changes were preserved.
