# 2026-06-09 - Chat Appearance Save Cleanup

## Changed Files

- `frontend/src/composables/chat/useChatAppearance.js`
- `backend/src/tests/frontendChatAppearance.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-appearance-save-cleanup.md`

## Summary

- Scoped chat appearance save final cleanup to the same conversation-aware guard used by save side effects.
- Removed the now-unused token-only `isActiveAppearanceSave()` helper.
- Kept stale conversation save completions from unlocking appearance controls or applying saved settings after the active conversation changes.

## Coverage

- Added a delayed save test that changes the active conversation while the appearance save request is pending.
- Added a source guard to keep final cleanup on `isCurrentAppearanceSave(requestToken, conversationId)` and prevent the token-only helper from returning.

## Validation

- PASS: `node --test src/tests/frontendChatAppearance.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing async finalizers that capture a route or conversation context but still clear busy state with weaker token-only checks.
