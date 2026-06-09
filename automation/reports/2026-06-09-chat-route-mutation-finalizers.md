# 2026-06-09 - Chat Route Mutation Finalizers

## Changed Files

- `frontend/src/composables/chat/useChatAccessory.js`
- `frontend/src/composables/chat/useChatMessageActions.js`
- `backend/src/tests/frontendChatAccessory.test.js`
- `backend/src/tests/frontendChatMessageActions.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-route-mutation-finalizers.md`

## Summary

- Scoped accessory skill save, status-bar save/delete, and branch-create final cleanup to the current conversation or route guard.
- Kept stale route completions from clearing busy state on replaced ChatView instances before explicit cleanup runs.
- Removed overlapping weak accessory coverage and kept the deterministic request-start tests plus a source guard for the finalizers.

## Coverage

- Added status-bar delete coverage for a conversation change while the delete request is pending.
- Added branch action coverage for route changes while branch creation is pending.
- Added source guards for route-aware final cleanup in chat branch and accessory mutation paths.

## Validation

- PASS: `node --test src/tests/frontendChatAccessory.test.js` in `backend`.
- PASS: `node --test src/tests/frontendChatMessageActions.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing chat async finalizers that still use token-only guards after capturing route or conversation context.
