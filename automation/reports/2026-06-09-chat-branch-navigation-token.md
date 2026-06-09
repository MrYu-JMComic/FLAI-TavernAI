# 2026-06-09 - Chat Branch Navigation Token

## Changed Files

- `frontend/src/composables/chat/useChatMessageActions.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatMessageActions.test.js`
- `backend/src/tests/frontendChatConversation.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-branch-navigation-token.md`

## Summary

- Added a branch-action invalidation callback for successful branch creation.
- Routed ChatView branch navigation through a helper that invalidates the branch action before emitting the new chat route.
- Kept the old ChatView branch busy state locked until keyed route cleanup instead of letting the stale action `finally` unlock it.

## Coverage

- Updated the ChatView source guard for branch navigation after sidebar refresh awaits.
- Added a runtime `useChatMessageActions` test proving branch navigation callbacks can invalidate the action and keep `branchBusy` locked until cleanup.

## Validation

- PASS: `node --test src/tests/frontendChatMessageActions.test.js src/tests/frontendChatConversation.test.js src/tests/frontendChatMessageItem.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing route-changing chat success paths, especially new-conversation creation and toast-driven settings actions.
