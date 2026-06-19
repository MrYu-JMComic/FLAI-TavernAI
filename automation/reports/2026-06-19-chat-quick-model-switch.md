# 2026-06-19 Chat quick model switch

## Summary

Added an inline model selector to the chat composer so users can switch the active provider model near the message input without opening the full model switcher. The selector keeps the current model pinned in the option list, dedupes provider models, disables while sending or saving, and shows a compact reasoning capability chip.

## Changed files

- `frontend/src/components/chat/ChatComposer.vue`
- `frontend/src/views/ChatView.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatComposer.test.js`

## Validation

- Passed: `node --test src/tests/frontendChatComposer.test.js src/tests/frontendChatModelSwitcher.test.js`
- Passed: `cd backend && npm test`
  - Result: 951 tests passed.
- Passed: `cd frontend && npm run build`
- Passed: `node scripts/check-encoding.mjs`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Notes

- No API, database schema, dependency, environment, upload, local data, or generated output change was required.
- Existing unrelated attachment-related backend worktree changes were left untouched.
- The next recommended task from the master plan is message operation accessibility improvements.
