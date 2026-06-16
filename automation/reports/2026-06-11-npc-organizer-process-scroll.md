# 2026-06-11 NPC Organizer Process Scroll

## Summary

Constrained the NPC organizer process log so long multi-round tool sessions scroll inside the organizer panel instead of pushing NPC memories and behavior controls out of the visible panel.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
  - Added a max height, internal vertical scrolling, stable scrollbar gutter, and contained overscroll to `.npc-organizer-process`.
- `backend/src/tests/frontendNpcPanel.test.js`
  - Added source coverage to keep the process log height limit in place.

## Validation

- `node --test backend\src\tests\frontendNpcPanel.test.js`
  - Passed: 13 tests.
- `node scripts/check-encoding.mjs`
  - Passed: scanned 634 files.
- `npm run build` in `frontend`
  - Passed.

## Notes

- Existing unrelated working-tree changes were left intact.

## Next Recommended Task

Consider adding collapsed-by-default completed organizer rounds if users want even denser logs after very large tool runs.
