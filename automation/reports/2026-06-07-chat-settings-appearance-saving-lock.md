# 2026-06-07 Chat Settings Appearance Saving Lock

## Goal

Prevent chat appearance settings from staying editable while a save is pending, which can make the saved result and visible draft feel out of sync.

## Changes

- Disabled current-conversation appearance fields while `appearanceSaving` is true.
- Disabled background upload inputs and clear buttons while appearance saving is pending.
- Disabled the chat world-book selector, reset button, and save button during appearance saves.
- Added `aria-busy` to the appearance save button.
- Added disabled styling for chat-setting upload labels and inline buttons.
- Added focused SFC source coverage for the saving-state bindings and disabled styles.

## Files Touched

- `frontend/src/components/chat/ChatSettingsDrawer.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatSettingsDrawer.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-settings-appearance-saving-lock.md`

## Validation

- `node --test backend\src\tests\frontendChatSettingsDrawer.test.js` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed:
  - Encoding check passed, scanning 537 files.
  - Unreferenced Vue component diagnostic found no unreviewed candidates.
  - Vue accessibility diagnostic found no inaccessible controls.
  - Backend tests passed: 466 tests.
  - Frontend build passed.

## Notes

- This only locks the appearance-save surface; accessory and status-bar editors keep their existing save-specific controls.
- Existing unrelated worktree changes were left untouched.
