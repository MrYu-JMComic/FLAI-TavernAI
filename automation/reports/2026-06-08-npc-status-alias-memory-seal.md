# NPC Status Alias Memory Seal

## Summary

- Added NPC registry metadata for status, custom status text, exact aliases, and optional memory sealing.
- Added an NPC update API path and frontend profile controls so each NPC can be edited from the NPC panel.
- Updated NPC prompt construction so status, aliases, behavior rules, and memory seal state affect the main reply context accurately.
- Allowed the NPC management assistant to record reusable behavior rules from plot evidence.

## Changed Files

- `backend/src/db.js`
- `backend/src/modules/npcs.js`
- `backend/src/routes/conversations.js`
- `backend/src/services/accessoryAgents.js`
- `backend/src/validations/schemas.js`
- `backend/src/tests/accessoryAgentsNpc.test.js`
- `backend/src/tests/frontendNpcPanel.test.js`
- `backend/src/tests/npcs.test.js`
- `frontend/src/api.js`
- `frontend/src/components/NpcPanel.vue`

## Validation

- `npm.cmd test` in `backend`: pass, 577 tests.
- `npm.cmd run build` in `frontend`: pass.
- Frontend build precheck `node ../scripts/check-encoding.mjs`: pass.

## Notes

- Memory sealing does not delete NPC memory rows. It only omits stored memories from the main NPC prompt while the NPC status is `dead` or `permanently_left` and sealing is enabled.
- If the NPC status later changes away from those terminal statuses, the existing memories become readable by the main prompt again.
- The worktree already contained many unrelated modified and deleted files. This iteration avoided reverting or rewriting unrelated changes.

## Next Recommended Task

- Add a short product-facing help hint or settings copy for the exact-alias rule if user testing shows confusion between aliases, nicknames, roles, and generic references.
