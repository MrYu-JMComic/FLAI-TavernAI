# NPC Profile UI Localization Toggle

## Summary

- Localized the NPC profile controls from English to Chinese.
- Replaced the raw memory-seal checkbox with a themed switch control.
- Updated the NPC profile form colors to use the app theme variables so light and dark modes stay readable.
- Added source-test coverage for the Chinese labels and switch styling hooks.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/frontendNpcPanel.test.js`

## Validation

- `npm.cmd run build` in `frontend`: pass.
- `node --test src/tests/frontendNpcPanel.test.js` in `backend`: pass, 3 tests.

## Notes

- The visible UI no longer uses the English labels from the NPC profile panel screenshot.
- The worktree still contains many unrelated pre-existing changes; this run did not revert or rewrite them.
