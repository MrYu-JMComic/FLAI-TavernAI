# 2026-06-07 Chat Header Conversation Ready Lock

## Goal

Prevent chat header panel buttons from looking clickable before the active conversation has loaded enough for those panels to mount.

## Changes

- Added a shared `conversationReady` computed state in `useChatConversation`.
- Guarded save, NPC, and economy panel open handlers behind `conversationReady`.
- Passed `conversationReady` from `ChatView` into `ChatHeader`.
- Disabled and marked busy the save, NPC, and economy header buttons while the active conversation is not ready.
- Added focused source coverage for the header UI lock, parent wiring, and composable guards.

## Files Touched

- `frontend/src/components/chat/ChatHeader.vue`
- `frontend/src/composables/chat/useChatConversation.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatHeader.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatHeader.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 482 backend tests and frontend build.

## Notes

- Navigation, theme switching, and sidebar opening remain available while conversation data is loading; only conversation-specific panel actions are locked.
