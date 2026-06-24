# NPC current location records

## Summary
- Added a `current_location` field to `npc_registry` with startup migration.
- Exposed NPC `currentLocation` through NPC list/profile updates, AI organizer tools, and the automatic NPC accessory agent.
- Injected current locations into the main NPC behavior prompt with explicit continuity guidance against teleporting or long-distance dialogue unless the story supports it.
- Added a dedicated NPC panel location tab, compact location labels in the NPC list/detail header, and updated empty-NPC cleanup so location-only NPCs are retained.

## Changed files
- `backend/src/db.js`
- `backend/src/modules/npcs.js`
- `backend/src/services/accessoryAgents.js`
- `backend/src/services/npcOrganizer.js`
- `backend/src/validations/schemas.js`
- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/accessoryAgents.test.js`
- `backend/src/tests/frontendNpcPanel.test.js`
- `backend/src/tests/npcOrganizer.test.js`
- `backend/src/tests/npcs.test.js`

## Validation
- `node --test src/tests/npcs.test.js src/tests/npcOrganizer.test.js src/tests/accessoryAgents.test.js src/tests/frontendNpcPanel.test.js` from `backend`: pass, 57 tests.
- `npm test` from `backend`: pass, 974 tests.
- `npm run build` from `frontend`: pass.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS.
- Encoding check passed through backend/frontend scripts and review gate.

## Notes
- Existing unrelated dirty work was preserved. This iteration only touched the files listed above plus this report.
- No files under `backend/data`, `backend/uploads`, `.env*`, `node_modules`, or generated build output were edited.

## Next recommended task
- Add a small visual/browser regression pass for the NPC panel on narrow mobile width once the local browser automation surface is available, checking that four tabs wrap cleanly and location labels truncate without covering counts.
