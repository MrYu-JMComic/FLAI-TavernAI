# 2026-06-09 - Chat Branch Navigation Guard

## Changed Files

- `frontend/src/composables/chat/useChatMessageActions.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatMessageActions.test.js`
- `backend/src/tests/frontendChatConversation.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-branch-navigation-guard.md`

## Summary

- Added a branch-action invalidation callback for successful conversation branch creation.
- Routed ChatView branch-created navigation through a small local helper that invalidates the branch action before emitting route navigation.
- Kept the old ChatView instance locked until cleanup so the branch action `finally` block cannot unlock stale route UI after navigation.

## Coverage

- Added focused composable coverage for branch navigation callbacks that intentionally keep `branchBusy` locked until cleanup.
- Updated ChatView source coverage to require the navigation helper after sidebar refresh completion.

## Validation

- PASS: `node --test src/tests/frontendChatMessageActions.test.js` in `backend`.
- PASS: `node --test src/tests/frontendChatConversation.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing route-changing async success paths, especially success callbacks that emit navigation after refreshing shared sidebar or list data.
