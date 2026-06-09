# 2026-06-09 - WorldBook Save Form Reset

## Changed Files

- `frontend/src/views/WorldBookView.vue`
- `backend/src/tests/frontendWorldBookView.test.js`
- `automation/reports/2026-06-09-worldbook-save-form-reset.md`

## Summary

- Added internal book and entry form reset helpers so successful save completions can close the dialogs while user cancel actions remain locked during `saving`.
- Closed the book form after successful create or update completions, and closed the entry form immediately after a successful entry mutation before refreshing detail data.
- Added source coverage that locks the internal save-completion reset path and prevents the guarded close function from being reused there.

## Validation

- PASS: `node --test src/tests/frontendWorldBookView.test.js` in `backend` (8 tests).
- PASS: `node scripts/check-encoding.mjs` (scanned 577 files).
- PASS: `npm test` in `backend` (871 tests).
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check` (line-ending warnings only).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Notes

- Existing unrelated `NpcPanel` worktree changes were left untouched and are not part of this report or intended commit.

## Next Recommended Task

- Continue auditing save-completion paths for actions that call user-facing cancel handlers while a busy guard is still active.
