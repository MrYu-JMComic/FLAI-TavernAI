# Chat Sidebar Stale Row Direct Guard

Date: 2026-06-08

## Summary

- Reworked the chat sidebar conversation row existence guard to scan the current conversation list directly.
- Kept open, select, and single-delete actions guarded against blank or stale row ids after list refreshes.
- Added source coverage to keep the guard off `conversations.value.some()` callback scans.

## Changed Files

- `frontend/src/composables/chat/useChatConversation.js`
- `backend/src/tests/frontendChatConversation.test.js`
- `backend/src/tests/frontendChatSidebar.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-chat-sidebar-stale-row-direct-guard.md`

## Validation

- `node --test backend\src\tests\frontendChatConversation.test.js backend\src\tests\frontendChatSidebar.test.js` - pass.
- `node scripts/check-encoding.mjs` - pass.
- `npm.cmd run build` in `frontend` - pass.
- `npm.cmd test` in `backend` - pass.
- `git diff --check` - pass with CRLF warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` - PASS.

## Notes

- Existing unrelated dirty files and untracked reports were preserved.
- Recommended next task: continue reviewing stale row guards in settings and NPC panels for direct current-list lookups.
