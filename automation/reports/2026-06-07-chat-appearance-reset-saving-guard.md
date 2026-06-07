# 2026-06-07 Chat Appearance Reset Saving Guard

## Goal

Prevent chat appearance reset events from bypassing the settings drawer saving lock while preserving internal appearance sync after loads and successful saves.

## Changes

- Added a guarded `resetConversationAppearance()` entry point that ignores UI reset events while appearance saving is pending.
- Routed the ChatView reset-appearance handler through the guarded reset entry point instead of calling the internal sync helper directly.
- Extended focused appearance diagnostics to cover saving-time reset behavior and ChatView event wiring.

## Files Touched

- `frontend/src/composables/chat/useChatAppearance.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatAppearance.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-appearance-reset-saving-guard.md`

## Validation

- `node --test backend\src\tests\frontendChatAppearance.test.js` passed: 4 tests.
- `node scripts\check-encoding.mjs` passed: scanned 561 files; no common Chinese mojibake markers found.
- `git diff --check` reported only LF-to-CRLF conversion warnings for existing dirty working-copy files; no whitespace errors were reported.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed: encoding check, unreferenced Vue component diagnostic, Vue accessibility diagnostic, backend tests (483 passed), and frontend build all passed.

## Notes

- `syncConversationAppearance()` remains available for trusted internal state refreshes from conversation loads and successful saves.
- Existing dirty worktree changes were preserved.
