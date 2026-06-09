# 2026-06-09 - Chat Message Action Route Cleanup

## Changed Files

- `frontend/src/composables/chat/useChatMessageActions.js`
- `backend/src/tests/frontendChatMessageActions.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-message-action-route-cleanup.md`

## Summary

- Scoped message edit and delete `finally` cleanup to the same route-aware action guard used by their mutation side effects.
- Removed the token-only message action cleanup helper so route changes cannot unlock stale ChatView message controls before cleanup.
- Preserved same-route stale-row behavior: replaced same-id message rows still skip side effects and clear the busy state normally.

## Coverage

- Added focused tests for edit-save and delete completions after `route.params.id` changes.
- Confirmed both paths keep `messageActionBusy` locked until `cleanup()` while skipping message mutations, notices, and sidebar refreshes.

## Validation

- PASS: `node --test src/tests/frontendChatMessageActions.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing async completions that already capture route context but still use route-agnostic final cleanup.
