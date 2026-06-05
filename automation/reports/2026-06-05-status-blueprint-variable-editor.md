# Status Blueprint Variable Editor Fix

## Summary

- Updated the character editor initial status bar variable list to distinguish text variables from numeric meter variables.
- Text variables now hide the misleading `/ 100` max input and color picker in the editor.
- Numeric variables are inferred from template placeholders such as `{{体力.percent}}`, `{{体力.max}}`, and `{{体力.color}}`.
- Saving now strips `max` and `color` from text-only variables so they do not come back as fake progress bars.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/styles.css`
- `automation/reports/2026-06-05-status-blueprint-variable-editor.md`

## Validation

- `node scripts/check-encoding.mjs` — PASS
- `npm.cmd run build` in `frontend` — PASS

## Notes

- The repository already contains many unrelated modified and untracked files. This iteration only targets the initial status bar variable editor.
