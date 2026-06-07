# 2026-06-07 Chat Composer Preset Entry Guard

## Goal

Prevent chat preset selection changes from bypassing the composer sending lock through parent-level update events.

## Changes

- Added a guarded `setSelectedPresetId()` entry point in `useChatSubmit`.
- Routed `ChatView` preset selection updates through the submit composable instead of directly assigning the ref.
- Added focused behavior coverage for sending-time preset updates and source coverage for the parent wiring.
- Made the `useChatSubmit` API import extension-explicit so Node diagnostics can import it directly.

## Files Touched

- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatSubmit.test.js`
- `backend/src/tests/frontendChatComposer.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatSubmit.test.js` passed.
- `node --test backend\src\tests\frontendChatComposer.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 480 backend tests and the frontend build.

## Notes

- Existing ChatComposer UI sending locks and stream/thinking guards were preserved.
- Existing dirty worktree changes were not reverted or rewritten.
