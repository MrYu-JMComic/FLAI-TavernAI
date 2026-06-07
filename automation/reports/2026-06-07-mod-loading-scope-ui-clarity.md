# 2026-06-07 Mod Loading Scope UI Clarity

## Summary

Improved the Mod editor loading-scope selector so users can clearly tell what each scope means.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `frontend/src/styles.css`

## Details

- Added visible title and short description text to each loading-scope option.
- Clarified the three choices as global loading, all-character loading, and selected-character loading.
- Reset the scope radio inputs locally so global text-input styling no longer stretches the radio control and hides the label.
- Kept the selected state visible through the option card border/background and normal radio check state.

## Validation

- `npm.cmd run build` in `frontend`: PASS.
- `node scripts/check-encoding.mjs`: PASS, scanned 417 files before this report.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS.

## Notes

- The worktree already had many unrelated modified and untracked files before this run; this iteration only changed the two UI files listed above plus this report.
