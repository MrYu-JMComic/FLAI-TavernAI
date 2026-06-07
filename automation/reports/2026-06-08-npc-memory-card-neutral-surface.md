# NPC Memory Card Neutral Surface

## Summary

- Removed the left accent strip from NPC memory cards.
- Replaced the green-tinted memory-card gradient with a neutral themed surface.
- Updated the NPC panel source test to guard against reintroducing left-strip pseudo elements or horizontal color-band gradients.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/frontendNpcPanel.test.js`

## Validation

- `node --test src/tests/frontendNpcPanel.test.js` in `backend`: pass, 4 tests.
- `npm.cmd run build` in `frontend`: pass.

## Notes

- The worktree already contains many unrelated changes. This run only touched the NPC panel memory card styling, its focused test, and this report.
