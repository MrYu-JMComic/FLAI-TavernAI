# 2026-06-07 Chat Model Switcher Open Sending Guard

## Goal

Prevent model switcher opening from bypassing the composer sending lock through parent-level events.

## Changes

- Added a `sending` guard to `ChatView.openModelSwitcher()`.
- Extended the focused ChatComposer source diagnostic to assert the parent open handler ignores events while a message request is in flight.

## Files Touched

- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatComposer.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-model-switcher-open-sending-guard.md`

## Validation

- `node --test backend\src\tests\frontendChatComposer.test.js` passed.
- `node scripts\check-encoding.mjs` passed: scanned 560 files; no common Chinese mojibake markers found.
- `git diff --check` reported only LF-to-CRLF conversion warnings for existing dirty working-copy files; no whitespace errors were reported.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed: encoding check, unreferenced Vue component diagnostic, Vue accessibility diagnostic, backend tests (482 passed), and frontend build all passed.

## Notes

- Existing ChatComposer button disabling and preset/stream/thinking guards were preserved.
- Existing dirty worktree changes were not reverted or rewritten.
