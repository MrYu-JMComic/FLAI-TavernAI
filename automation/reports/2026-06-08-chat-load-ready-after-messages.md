# Chat Load Ready After Messages

## Summary

- Reviewed the chat conversation load path for UI/status refresh delays.
- Released the main chat loading state immediately after the active conversation and messages render once.
- Kept appearance, status bar, accessory skills, message swipes, branches, and NPC fingerprint refreshes guarded by the existing stale-load checks.
- Updated the ChatView source contract test so future changes keep the main loading notice from waiting on slower accessory refresh work.

## Changed Files

- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatConversation.test.js`
- `automation/reports/2026-06-08-chat-load-ready-after-messages.md`

## Validation

- PASS: `node --test backend\src\tests\frontendChatConversation.test.js`
  - Result: 27 tests passed.
- PASS: `node scripts/check-encoding.mjs`
  - Result: scanned 389 files; no common Chinese mojibake markers found.
- PASS: `npm.cmd test` from `backend`
  - Result: 738 tests passed.
- PASS: `npm.cmd run build` from `frontend`
  - Result: Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: review gate passed.

## Existing Worktree Notes

- Preserved existing report changes outside this iteration:
  - `automation/reports/2026-06-08-unreferenced-vue-import-suffix-scan.md`
  - `automation/reports/2026-06-08-character-world-book-dialog.md`

## Next Recommended Task

- Continue auditing status and accessory refresh paths for places where user-visible readiness is tied to slower secondary data refreshes.
