# 2026-06-09 - Chat New Conversation Navigation Token

## Changed Files

- `frontend/src/composables/chat/useChatConversation.js`
- `backend/src/tests/frontendChatConversation.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-new-conversation-navigation-token.md`

## Summary

- Routed successful new-chat navigation through a helper that invalidates the start-conversation token before emitting the new chat route.
- Kept the old ChatView `startConversationBusy` state locked until keyed route cleanup instead of letting the stale action `finally` unlock it after navigation.

## Coverage

- Updated the duplicate-create guard test to assert new-chat busy state stays locked through navigation and cleanup releases it.
- Added a source guard requiring `navigateFromStartConversation()` and blocking a direct success-path navigation emit.

## Validation

- PASS: `node --test src/tests/frontendChatConversation.test.js src/tests/frontendChatSidebar.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing route-changing success paths in ChatView and shared toast/navigation helpers.
