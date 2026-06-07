# 2026-06-07 Chat Sidebar Loading State

## Goal

Make Chat sidebar retry/loading state visible and timely while sidebar data is being refreshed.

## Changes

- Added `sidebarLoading` to the chat conversation composable.
- Kept `sidebarLoading` true while the latest sidebar data load is pending and reset it after completion or cleanup.
- Passed the loading state into `ChatSidebar`.
- Disabled the retry button during a pending reload, changed its label to `加载中`, and animated the refresh icon.
- Disabled Chat sidebar selection controls while conversation actions are busy and styled disabled checkboxes.
- Added regression coverage for pending-state transitions and cleanup reset behavior.

## Files Touched

- `frontend/src/composables/chat/useChatConversation.js`
- `frontend/src/components/chat/ChatSidebar.vue`
- `frontend/src/views/ChatView.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatConversation.test.js`
- `automation/backlog.md`

## Validation

- `backend`: `node --test backend\src\tests\frontendChatConversation.test.js` passed.
- `frontend`: `npm run build` passed.
- `review-gate`: passed with 449 backend tests and a successful frontend build.

## Notes

- Existing unrelated worktree changes and reports were preserved.
