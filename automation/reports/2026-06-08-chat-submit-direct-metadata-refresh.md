# Chat submit direct metadata refresh

## Summary

- Built chat chrome refresh tasks directly instead of creating a nullable array and filtering it.
- Compared usage and provider metadata with direct array/object loops instead of `.every()` callback chains.
- Added source coverage to keep the chat submit hot path free of those callback allocation patterns.

## Changed Files

- `frontend/src/composables/chat/useChatSubmit.js`
- `backend/src/tests/frontendChatSubmit.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-chat-submit-direct-metadata-refresh.md`

## Validation

- `node --test backend\src\tests\frontendChatSubmit.test.js` passed: 26 tests.
- `node scripts/check-encoding.mjs` passed: 427 files scanned.
- `npm.cmd run build` passed in `frontend`.
- `npm.cmd test` passed in `backend`: 764 tests.
- `git diff --check` passed with CRLF normalization warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed.

## Next Recommended Task

- Continue the UI freshness/performance audit in `CharacterFormView.vue`, where world-book selection and status variable comparison helpers still have callback-heavy paths.
