# 2026-06-05 Status Bar Background Refresh

## Summary

- Fixed chat status bar refresh after background accessory agents finish later than the main assistant reply.
- Extended the frontend background refresh window with sparse backoff polling up to 55 seconds.
- Kept status/economy refresh asynchronous so it does not block the main reply or typewriter flow.
- Added a conversation-id guard when loading status bars so delayed refreshes cannot overwrite a different chat.

## Changed Files

- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/composables/chat/useChatAccessory.js`

## Validation

- `node scripts/check-encoding.mjs`: PASS
- `npm.cmd run build` in `frontend`: PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS

## Notes

- The working tree already had many unrelated modified and untracked files before this run.
- Vite still reports the existing large chunk warning for `StatusBar`, but the build succeeds.
