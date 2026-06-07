# 2026-06-07 Chat Composer Sending Config Lock

## Goal

Prevent chat composer configuration controls from visually switching to a new setup while the current message request is already in flight.

## Changes

- Marked the composer form as busy while `sending` is true.
- Disabled preset selection, quick model switching, stream-mode toggle, and thinking-mode toggle while sending.
- Added `aria-busy` to the model, stream, and thinking controls during sending.
- Added direct guards to `toggleUseStream` and `toggleThinking` so the composable cannot be toggled through non-UI callers while sending.
- Added focused SFC/source coverage for the composer sending lock.

## Files Touched

- `frontend/src/components/chat/ChatComposer.vue`
- `frontend/src/composables/chat/useChatSubmit.js`
- `backend/src/tests/frontendChatComposer.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatComposer.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 478 backend tests and the frontend build.

## Notes

- The message textarea remains editable while sending so the next message draft can still be prepared; only request configuration controls are locked.
