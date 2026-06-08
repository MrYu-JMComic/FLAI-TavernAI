# 2026-06-08 Character World Book Dialog Overlap

## Scope

- Fix mobile UI overlap in the character form world book selection dialog.
- Keep the existing search, sorting, and pagination behavior unchanged.

## Changed Files

- `frontend/src/styles.css`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/reports/2026-06-08-character-world-book-dialog-overlap.md`

## What Changed

- Kept world book dialog list rows aligned to the top instead of stretching.
- Changed mobile world book option rows to a stable two-column grid with named areas:
  checkbox on the left, title/description and metadata on the right.
- Added test assertions so the mobile dialog keeps the non-overlapping grid layout.

## Validation

- PASS: `node --test src\tests\frontendCharacterFormView.test.js`
- PASS: `npm.cmd run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- No secrets were written.
- Existing unrelated workspace changes were not intentionally modified.
