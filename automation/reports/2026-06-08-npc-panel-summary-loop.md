# NpcPanel Summary Loop

## Summary

- Reviewed `NpcPanel` list-derived UI state for repeated reactive scans.
- Combined panel NPC counts, memory totals, behavior totals, and empty NPC names into one computed pass over `npcs`.
- Kept the existing `npcPanelStats` and `emptyNpcNames` computed values intact for the template.
- Added source coverage so the panel does not regress to separate `reduce()`, `filter()`, and `map()` scans for the same list.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/frontendNpcPanel.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-npc-panel-summary-loop.md`

## Validation

- PASS: `node --test backend\src\tests\frontendNpcPanel.test.js`
  - Result: 6 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 396 files; no common Chinese mojibake markers found.
- PASS: `npm.cmd run build` in `frontend`
  - Result: Vite production build completed.
- PASS: `npm.cmd test` in `backend`
  - Result: 743 tests passed.
- PASS: `git diff --check`
  - Result: no whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 743 tests, frontend build passed, review gate passed.

## Existing Worktree Notes

- Preserved existing unrelated changes in provider/frontend SSE parsing, CharacterForm/world-book dialog styling, frontend API tests, WorldBookView tests, and earlier automation reports.

## Next Recommended Task

- Continue auditing side panels for multiple computed values derived from the same reactive list, especially places where refreshes can re-render large lists without visible data changes.
