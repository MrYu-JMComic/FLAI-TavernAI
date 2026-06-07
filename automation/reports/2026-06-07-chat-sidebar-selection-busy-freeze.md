# 2026-06-07 Chat Sidebar Selection Busy Freeze

## Goal

Keep Chat sidebar bulk-selection state stable while a conversation delete action is already pending.

## Changes

- Blocked `toggleConversationSelection()` and `toggleAllVisibleConversations()` while `conversationActionBusy` is true.
- Disabled the sidebar select-all button during delete mutations.
- Disabled per-conversation selection checkboxes during delete mutations.
- Added a disabled visual state for the custom history checkbox.
- Added regression coverage proving selection state does not change while a conversation action is busy.

## Files Touched

- `frontend/src/composables/chat/useChatConversation.js`
- `frontend/src/components/chat/ChatSidebar.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatConversation.test.js`

## Validation

- `backend`: `node --test backend\src\tests\frontendChatConversation.test.js` passed.

## Notes

- Existing staged worktree changes and reports were preserved.
