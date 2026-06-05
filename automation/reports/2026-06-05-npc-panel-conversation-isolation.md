# NPC Panel Conversation Isolation

## Summary

- Fixed NPC panel state leakage when switching conversations while the panel is open.
- Reset NPC list, selected NPC, memories, and behaviors immediately on `conversationId` changes.
- Added request tokens so stale NPC list/detail responses cannot write into a newer conversation UI.
- Guarded NPC memory, behavior, single-hide, and bulk-hide actions against late responses after a conversation switch.
- Added backend regression coverage to ensure hidden NPC state is scoped to one conversation.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/npcs.test.js`

## Validation

- `backend`: `node --test src/tests/npcs.test.js` passed, 12 tests.
- `backend`: `npm.cmd test` passed, 227 tests.
- `frontend`: `npm.cmd run build` passed; Vite reported the existing large chunk warning for `StatusBar`.
- `root`: `node scripts/check-encoding.mjs` passed.

## Next Recommended Task

- Add a small frontend component test or Playwright check for switching conversations while NPC requests are still in flight.
