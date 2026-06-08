# 2026-06-09 - Shared Event Method Helper

## Changed Files

- `frontend/src/utils/eventMethods.js`
- `frontend/src/views/ChatView.vue`
- `frontend/src/views/SettingsView.vue`
- `backend/src/tests/frontendEventMethods.test.js`
- `backend/src/tests/frontendChatConversation.test.js`
- `backend/src/tests/frontendSettingsView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-shared-event-method-helper.md`

## Summary

- Added a shared `callEventMethod()` helper that checks event method callability before invoking it with the event as the receiver.
- Routed ChatView global NPC panel suppression, composer enter handling, and SettingsView drag prevention through the helper so malformed synthetic events with non-callable method fields cannot throw.

## Validation

- PASS: `node --test src/tests/frontendEventMethods.test.js src/tests/frontendChatConversation.test.js src/tests/frontendSettingsView.test.js` in `backend` (49 tests)
- PASS: `node --test src/tests/frontendChatSubmit.test.js` in `backend` (27 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 560 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (853 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

- Continue replacing optional event method calls with `callEventMethod()` where handlers intentionally tolerate synthetic or partial event objects.
