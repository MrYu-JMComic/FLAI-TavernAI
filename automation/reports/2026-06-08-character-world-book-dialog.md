# 2026-06-08 Character World Book Dialog

## Scope

- Move the character form world book linking control out of the inline checkbox stack.
- Add search, sorting, pagination, and compact selected-world-book preview.
- Keep the control themed for light and dark mode.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/reports/2026-06-08-character-world-book-dialog.md`

## What Changed

- Replaced the inline `world-book-selector` checkbox list with a compact picker button and selected summary chips.
- Added a modal dialog for choosing linked world books.
- Added search by name or description, sorting by recently updated/name/entry count, and paged results.
- Added responsive styling so the dialog is centered on desktop and bottom-sheet-like on mobile.
- Added source tests covering the dialog state, computed filtering/paging, template structure, and themed CSS.

## Validation

- PASS: `node --test src\tests\frontendCharacterFormView.test.js`
- PASS: `npm.cmd run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- No secrets were written.
- Existing unrelated workspace changes were not intentionally modified.

## Next Recommended Task

- Add request-level UI testing for the dialog once a browser automation suite is available for character form flows.
