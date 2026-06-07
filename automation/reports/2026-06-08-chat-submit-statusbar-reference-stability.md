# 2026-06-08 Chat Submit Status Bar Reference Stability

## Scope

- Continue the chat accessory reference-stability audit.
- Avoid direct status-bar replacement from chat submit responses when refreshed status-bar data is unchanged.

## Changed Files

- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/composables/chat/useChatAccessory.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatSubmit.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-chat-submit-statusbar-reference-stability.md`

## What Changed

- Exposed `applyStatusBarUpdate` from the chat accessory composable.
- Passed that helper into `useChatSubmit` from `ChatView`.
- Routed non-stream, stream tool, and stream done status-bar payloads through the helper instead of assigning directly.
- Kept the direct assignment path as a fallback for tests or callers that do not provide the helper.
- Added focused coverage for non-stream and streaming status-bar updates preserving unchanged refs.

## Validation

- PASS: `node --test backend\src\tests\frontendChatSubmit.test.js`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- No secrets were written.
- Existing staged report archival work was preserved.

## Next Recommended Task

- Continue reviewing stream skill-result and accessory refresh paths for remaining direct status-bar or nested object replacement.
