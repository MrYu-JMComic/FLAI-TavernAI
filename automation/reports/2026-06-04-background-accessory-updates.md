# 2026-06-04 Background Accessory Updates

## Summary

- Moved status bar, NPC memory, and economy accessory agents out of the main chat response path.
- The assistant reply now finishes and emits `done` before accessory agents run in the background.
- The frontend releases the send/typewriter state immediately after the main reply, then refreshes status/economy/NPC UI asynchronously.
- NPC panel refreshes only when it is open, avoiding unnecessary repeated requests.

## Changed Files

- `backend/src/routes/conversations.js`
- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/views/ChatView.vue`
- `frontend/src/components/NpcPanel.vue`

## Validation

- `npm.cmd run build` in `frontend`: PASS
- `node scripts/check-encoding.mjs`: PASS
- `npm.cmd test` in `backend`: PASS, 206 tests
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS

## Notes

- The working tree already contains many unrelated modified and untracked files; this run only targeted the chat accessory update flow.
- Vite still reports the existing large chunk warning for `StatusBar`, but the build succeeds.
