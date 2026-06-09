# 2026-06-09 - Chat Active Delete Navigation Guard

## Changed Files

- `frontend/src/composables/chat/useChatConversation.js`
- `backend/src/tests/frontendChatConversation.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-active-delete-navigation-guard.md`

## Summary

- Routed chat sidebar navigation after deleting the active conversation through a small helper.
- The helper invalidates the conversation action token before navigating to the next conversation or home.
- This keeps the old route instance from clearing `conversationActionBusy` during route replacement while leaving non-active conversation deletion cleanup unchanged.

## Coverage

- Added a focused `frontendChatConversation.test.js` case for deleting the active conversation.
- The test verifies the list is pruned, navigation moves to the next conversation, action busy stays locked on the stale route instance, and cleanup releases it.

## Validation

- PASS: `node --test src/tests/frontendChatConversation.test.js` in `backend`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue checking chat conversation route-changing success paths for cleanup that can run after navigation emits.
