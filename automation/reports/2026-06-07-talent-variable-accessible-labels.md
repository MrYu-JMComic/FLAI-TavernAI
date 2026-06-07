# 2026-06-07 Talent And Variable Accessible Labels

## Backlog Item

- Burn down `node scripts/find-inaccessible-vue-controls.mjs --json` findings.

## Changes

- Added accessible names to `frontend/src/components/TalentRollDialog.vue`.
  - Talent dialog close button.
  - Roll result close button.
  - Per-talent remove buttons.
- Added `ariaLabel` support to `frontend/src/components/VariableEditor.vue` and wired it to the underlying textarea.
- Passed specific accessible names for the background, worldview, persona, and opening message variable editors in `frontend/src/views/CharacterFormView.vue`.
- Updated `automation/backlog.md` to reflect the current diagnostic count.

## Diagnostic Result

- Before this run, the Vue accessibility diagnostic reported 46 potentially inaccessible controls.
- After this run, `node scripts/find-inaccessible-vue-controls.mjs` reports 42 potentially inaccessible controls.
- `TalentRollDialog.vue` and `VariableEditor.vue` no longer appear in the diagnostic output.

## Validation

- PASS: `node scripts/find-inaccessible-vue-controls.mjs --json`.
- PASS: `node scripts/find-inaccessible-vue-controls.mjs`.
- PASS: `npm.cmd run build` in `frontend`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic ran and reported 42 findings as non-blocking.
  - Backend tests passed: 393/393.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report was written.

## Notes

- The worktree already contained many modified and untracked files from earlier iterations; this run intentionally changed the two frontend components, one existing caller, backlog count, and this report.
- Next recommended task: reduce the remaining accessibility findings in `CharacterFormView.vue`, then continue into `PresetView.vue`, `SettingsView.vue`, and `WorldBookView.vue`.
