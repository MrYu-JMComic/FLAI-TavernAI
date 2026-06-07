# 2026-06-07 Chat New Conversation Busy Guard

## Goal

Prevent stale or duplicate UI actions when the Chat sidebar new-conversation request is still pending.

## Changes

- Added `startConversationBusy` to the chat conversation composable.
- Blocked repeated `startNewConversation()` calls while the first create request is pending.
- Disabled the Chat sidebar new-chat button and exposed `aria-busy` during the pending request.
- Added regression coverage proving rapid duplicate starts issue only one create request.

## Files Touched

- `frontend/src/composables/chat/useChatConversation.js`
- `frontend/src/components/chat/ChatSidebar.vue`
- `frontend/src/views/ChatView.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatConversation.test.js`
- `automation/backlog.md`

## Validation

- `backend`: `node --test backend\src\tests\frontendChatConversation.test.js` passed.

## Notes

- Existing unrelated worktree changes and reports were preserved.
