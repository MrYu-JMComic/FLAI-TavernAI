# Status Blueprint UI And Template Limit Fix

## Summary

- Removed the extra text-variable hint column that caused the initial status bar variable rows to overlap with the delete button.
- Kept text variable rows compact as `name / type / value / delete`, while numeric rows still show max and color controls.
- Increased status bar custom template limits from 5,000 to 50,000 characters for character blueprints and conversation status bars.
- Added a backend regression assertion that long status bar templates pass character update validation and are not truncated by advanced settings normalization.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/styles.css`
- `backend/src/validations/schemas.js`
- `backend/src/modules/advancedSettings.js`
- `backend/src/modules/statusBars.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-05-status-blueprint-ui-and-template-limit.md`

## Validation

- `node scripts/check-encoding.mjs` — PASS
- `node --test src\tests\backend.test.js` from `backend` — PASS
- `npm.cmd run build` from `frontend` — PASS

## Notes

- The repository already contains many unrelated modified and untracked files. This iteration only targets the initial status bar editor layout and custom template length limit.
