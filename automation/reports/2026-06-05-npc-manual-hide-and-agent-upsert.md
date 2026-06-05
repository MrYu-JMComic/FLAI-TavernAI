# NPC Manual Hide and Agent Upsert

## Summary

- Added an `npc_registry` table so confirmed NPCs and hidden false positives have durable per-conversation state.
- Added manual NPC removal from the panel; removal hides the NPC from the list without deleting memories or behavior records.
- Updated NPC discovery to merge registry entries, memories, behaviors, and conservative scan results while excluding hidden names.
- Updated the NPC Agent to call `upsert_npc` for clearly present side characters and skip names the user has hidden.
- Kept regex scanning as a fallback only when the structured Agent flow records nothing.

## Changed Files

- `backend/src/db.js`
- `backend/src/modules/npcs.js`
- `backend/src/routes/conversations.js`
- `backend/src/services/accessoryAgents.js`
- `backend/src/tests/accessoryAgents.test.js`
- `backend/src/tests/npcs.test.js`
- `frontend/src/api.js`
- `frontend/src/components/NpcPanel.vue`

## Validation

- `backend`: `node --test src/tests/npcs.test.js` passed, 10 tests.
- `backend`: `node --test src/tests/accessoryAgents.test.js` passed, 7 tests.
- `backend`: `npm.cmd test` passed, 225 tests.
- `frontend`: `npm.cmd run build` passed; Vite reported the existing large chunk warning for `StatusBar`.
- `root`: `node scripts/check-encoding.mjs` passed.

## Next Recommended Task

- Add an optional “restore hidden NPC” view if users later want to undo accidental removals without waiting for an Agent re-confirmation flow.
