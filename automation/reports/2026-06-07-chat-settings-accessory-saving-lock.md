# 2026-06-07 Chat Settings Accessory Saving Lock

## Goal

Prevent ChatSettingsDrawer accessory-skill controls from being edited while accessory settings are saving.

## Changes

- Converted the expanded accessory-skill grid into a disabled `fieldset` tied to `accessorySaving`.
- Added `aria-busy` to the accessory-skill grid while saving is pending.
- Reset the fieldset border, margin, and padding so the existing grid layout remains unchanged.
- Added focused SFC source coverage for the accessory-saving lock and fieldset styling.

## Files Touched

- `frontend/src/components/chat/ChatSettingsDrawer.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatSettingsDrawer.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatSettingsDrawer.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 470 backend tests and the frontend build.

## Notes

- Existing appearance and status-bar saving locks in the worktree were preserved and not rewritten.
