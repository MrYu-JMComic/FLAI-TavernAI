# Streamed User Message Actions Report

## Summary

- Fixed streamed chat sends leaving the user message with a temporary `local-user-*` id until page refresh.
- The backend now emits the persisted user message at the start of the SSE stream and includes it in the final `done` event.
- The frontend now replaces the local user draft with the persisted message as soon as that SSE event arrives, so edit and delete controls become available without refreshing.

## Changed Files

- `backend/src/routes/conversations.js`
- `frontend/src/composables/chat/useChatSubmit.js`
- `automation/reports/2026-06-06-streamed-user-message-actions.md`

## Validation

- `npm.cmd run build` in `frontend`: passed.
- `node scripts/check-encoding.mjs`: passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: passed.
  - Backend tests: 353 passed, 0 failed.
  - Frontend build: passed.

## Notes

- The working tree already contained unrelated changes in backend modules/tests, chat model switcher frontend files, styles, and earlier automation reports. This run only intentionally changed streamed message id synchronization and this report.

## Next Recommended Task

- Manually send one streamed message, stop one streamed generation, and verify the sent user bubble can be edited or deleted immediately in both cases.
