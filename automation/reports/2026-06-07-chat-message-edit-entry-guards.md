# 2026-06-07 Chat Message Edit Entry Guards

## Goal

Align chat message edit draft mutations with the existing message-action busy state, including programmatic events that bypass disabled edit controls.

## Changes

- Added a guarded `setEditingMessageContent()` entry point in `useChatMessageActions`.
- Guarded `cancelEditMessage()` while a message action is pending, so the edit box cannot disappear mid-save from a delayed event.
- Routed `ChatView` message-edit content updates through the composable entry point instead of mutating the ref inline.
- Added focused behavior coverage for busy edit draft updates and extended the existing SFC wiring diagnostic.

## Files Touched

- `frontend/src/composables/chat/useChatMessageActions.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatMessageActions.test.js`
- `backend/src/tests/frontendChatMessageItem.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatMessageActions.test.js` passed.
- `node --test backend\src\tests\frontendChatMessageItem.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 475 backend tests and the frontend build.

## Notes

- Existing busy UI wiring in `ChatMessageItem.vue` was preserved.
- Existing unrelated changes in the dirty worktree were not reverted or rewritten.
