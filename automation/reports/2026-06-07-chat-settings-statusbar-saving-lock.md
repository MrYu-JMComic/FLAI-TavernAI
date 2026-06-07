# 2026-06-07 Chat Settings Status Bar Saving Lock

## Goal

Prevent ChatSettingsDrawer status-bar editor controls from being edited while a status-bar save is pending.

## Changes

- Wrapped the status-bar editor body in one disabled `fieldset` tied to `statusBarSaving`, instead of adding scattered per-control guards.
- Marked the editor as busy while status-bar saving is pending.
- Reset the disabled fieldset styling so the editor layout stays unchanged.
- Limited variable-remove hover styling to enabled buttons, so disabled remove controls do not look clickable.
- Added focused SFC source coverage for the saving lock and disabled hover guard.

## Files Touched

- `frontend/src/components/chat/ChatSettingsDrawer.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatSettingsDrawer.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatSettingsDrawer.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 467 backend tests and the frontend build.

## Notes

- Existing appearance-saving lock changes in the worktree were preserved and not rewritten.
