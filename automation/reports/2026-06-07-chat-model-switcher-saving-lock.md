# 2026-06-07 Chat Model Switcher Saving Lock

## Goal

Keep the chat model switcher draft stable while a model-save request is pending, so the visible selection cannot drift away from the model being saved.

## Changes

- Added a `modelSelectionLocked` state that follows `saving`.
- Blocked model selection changes while saving is pending.
- Disabled model search, model refresh, and model option buttons while saving.
- Added `aria-busy` to the switcher, refresh buttons, active saving option, and save button.
- Added disabled styles for the search field and model option buttons.
- Added focused SFC source coverage for the save lock, template bindings, and disabled styles.

## Files Touched

- `frontend/src/components/chat/ChatModelSwitcher.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatModelSwitcher.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-model-switcher-saving-lock.md`

## Validation

- `node --test backend\src\tests\frontendChatModelSwitcher.test.js` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed:
  - Encoding check passed, scanning 540 files.
  - Unreferenced Vue component diagnostic found no unreviewed candidates.
  - Vue accessibility diagnostic found no inaccessible controls.
  - Backend tests passed: 468 tests.
  - Frontend build passed.

## Notes

- Existing provider-context draft reset logic remains unchanged.
- Existing unrelated worktree changes were left untouched.
