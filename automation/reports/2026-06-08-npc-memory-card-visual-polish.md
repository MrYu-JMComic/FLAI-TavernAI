# NPC Memory Card Visual Polish

## Summary

- Reworked NPC memory cards from a heavy dark-to-light gradient into a softer themed card surface.
- Added a dedicated `npc-memory-card` class with a subtle side accent and light/dark mode backgrounds.
- Updated NPC card labels, timestamps, controls, and content colors to rely on theme variables instead of the old blue-purple accent treatment.
- Added source-test coverage so the memory card keeps the themed soft-card styling.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/frontendNpcPanel.test.js`

## Validation

- `node --test src/tests/frontendNpcPanel.test.js` in `backend`: pass, 4 tests.
- `npm.cmd run build` in `frontend`: pass.

## Notes

- The worktree already contains many unrelated modified, deleted, and untracked files. This run only touched the NPC panel, its source test, and this report.
