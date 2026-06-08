# NpcPanel Selected Row Direct Lookup

Date: 2026-06-08

## Summary

- Routed selected NPC detail lookup through a single direct current-list scan helper.
- Reused the same helper when NPC list refreshes prune a missing selected NPC.
- Added source coverage to keep selected NPC lookup off `npcs.value.find()` callback scans.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/frontendNpcPanel.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-npc-panel-selected-row-direct-lookup.md`

## Validation

- `node --test backend\src\tests\frontendNpcPanel.test.js` - pass, 7 tests.
- `node scripts/check-encoding.mjs` - pass.
- `npm.cmd run build` in `frontend` - pass.
- `npm.cmd test` in `backend` - pass.
- `git diff --check` - pass with CRLF warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` - PASS.

## Notes

- Existing unrelated dirty files and untracked reports were preserved.
- Recommended next task: continue reviewing selected-row helpers in SettingsView for direct current-list scans.
