# 2026-06-07 NPC And Save Accessible Labels

## Backlog Item

- Burn down `node scripts/find-inaccessible-vue-controls.mjs --json` findings.

## Changes

- Added accessible names to `frontend/src/components/NpcPanel.vue`.
  - NPC panel close button.
  - NPC list refresh button.
  - Memory type select and memory content textarea.
  - Memory delete button.
  - Behavior type select, trigger input, and action textarea.
  - Behavior enable/disable and delete buttons.
- Added accessible names to `frontend/src/components/SaveLoadPanel.vue`.
  - Save panel close button.
  - New save name input.
  - Rename save input, confirm button, and cancel button.
  - Load, rename, and delete save action buttons.
- Updated `automation/backlog.md` to reflect the current diagnostic count.

## Diagnostic Result

- Before this run, the Vue accessibility diagnostic reported 63 potentially inaccessible controls.
- After this run, `node scripts/find-inaccessible-vue-controls.mjs` reports 46 potentially inaccessible controls.
- `NpcPanel.vue` and `SaveLoadPanel.vue` no longer appear in the diagnostic output.

## Validation

- PASS: `node scripts/find-inaccessible-vue-controls.mjs --json`.
- PASS: `node scripts/find-inaccessible-vue-controls.mjs`.
- PASS: `npm.cmd run build` in `frontend`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic ran and reported 46 findings as non-blocking.
  - Backend tests passed: 393/393.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report was written.

## Notes

- The worktree already contained many modified and untracked files from earlier iterations; this run intentionally changed the two frontend components, backlog count, and this report.
- Next recommended task: reduce the remaining accessibility findings in `TalentRollDialog.vue` and `VariableEditor.vue`, then continue into the larger view files.
