# 2026-06-07 Chat Settings Status Bar Action Saving Lock

## Goal

Prevent ChatSettingsDrawer status-bar actions from changing editor state or deleting the status bar while a status-bar save is pending.

## Changes

- Disabled the status-bar create, edit, and delete buttons while `statusBarSaving` is true.
- Added `aria-busy` to status-bar action buttons and the save button while a save is pending.
- Disabled the status-bar editor cancel button while saving so the visible busy state stays attached to the pending operation.
- Extended the focused ChatSettingsDrawer SFC source test to cover these action-level saving locks.

## Files Touched

- `frontend/src/components/chat/ChatSettingsDrawer.vue`
- `backend/src/tests/frontendChatSettingsDrawer.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatSettingsDrawer.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 471 backend tests and the frontend build.

## Notes

- Existing status-bar editor fieldset locking was preserved; this iteration only aligned the action buttons around it.
