# Regex Preview Empty State

## Summary

- Removed the default regex preview sample text from the character form.
- Added a placeholder for the preview input.
- Added an empty-state hint so the replacement result only appears after the user enters test text.
- Adjusted the preview empty-state color to use the muted text color.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/styles.css`

## Validation

- `node scripts/check-encoding.mjs` - passed
- `npm.cmd run build` in `frontend` - passed

## Review Gate

- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` - passed

## Notes

- The working tree contains many pre-existing modified and untracked files. This iteration only targeted the regex preview UI.
