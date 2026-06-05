# NPC Bulk Hide Empty

## Summary

- Added a backend helper to batch hide visible NPCs with zero memories and zero behavior rules.
- Added a conversation API endpoint for bulk hiding empty NPCs without deleting saved memories or behaviors.
- Added a “清理空项” action in the NPC panel so users can remove empty false positives in one click.
- Added regression coverage to keep NPCs with memories or behavior rules visible during bulk cleanup.

## Changed Files

- `backend/src/modules/npcs.js`
- `backend/src/routes/conversations.js`
- `backend/src/tests/npcs.test.js`
- `frontend/src/api.js`
- `frontend/src/components/NpcPanel.vue`

## Validation

- `backend`: `node --test src/tests/npcs.test.js` passed, 11 tests.
- `backend`: `npm.cmd test` passed, 226 tests.
- `frontend`: `npm.cmd run build` passed; Vite reported the existing large chunk warning for `StatusBar`.
- `root`: `node scripts/check-encoding.mjs` passed.

## Next Recommended Task

- Add a hidden-NPC recovery view so accidental cleanup can be undone from the UI.
