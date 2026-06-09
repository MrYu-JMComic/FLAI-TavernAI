# NPC Memory And Behavior Edit Fix

## Changed Files

- `backend/src/modules/npcs.js`
- `backend/src/routes/conversations.js`
- `backend/src/validations/schemas.js`
- `backend/src/services/accessoryAgents.js`
- `frontend/src/api.js`
- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/npcs.test.js`
- `backend/src/tests/backend.test.js`
- `backend/src/tests/frontendNpcPanel.test.js`
- `backend/src/tests/accessoryAgents.test.js`
- `backend/src/tests/accessoryAgentsNpc.test.js`
- `automation/reports/2026-06-09-npc-memory-behavior-edit.md`

## Summary

- Added scoped NPC memory update support through the backend module, route, frontend API, and NPC panel inline editor.
- Added inline edit controls for NPC memories and behavior rules with separate edit drafts, so add forms and edit forms do not overwrite each other.
- Fixed behavior-rule toggle updates by replacing the defaulting partial schema with an update-only schema that preserves omitted fields.
- Aligned NPC memory and behavior validation enums with the values used by the UI and storage layer.
- Made the NPC accessory agent more conservative: auto behavior rules now require a clear trigger condition and stop adding rules once an NPC already has eight.

## Validation

- PASS: `node --test src\tests\npcs.test.js src\tests\backend.test.js src\tests\frontendNpcPanel.test.js src\tests\accessoryAgents.test.js src\tests\accessoryAgentsNpc.test.js` in `backend` (329 tests).
- PASS: `npm test` in `backend` (includes `node ../scripts/check-encoding.mjs`; 869 tests).
- PASS: `npm run build` in `frontend` (includes `node ../scripts/check-encoding.mjs`).
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` (includes encoding checks, diagnostics, backend tests, and frontend build).

## Next Recommended Task

- Manually open the NPC panel in a chat, edit one memory and one behavior rule, then click the behavior enable toggle to confirm the action and trigger text remain intact.
