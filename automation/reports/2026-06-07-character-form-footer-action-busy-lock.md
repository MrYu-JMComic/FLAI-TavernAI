# 2026-06-07 Character Form Footer Action Busy Lock

## Goal

Prevent CharacterFormView footer actions from overlapping saves, deletes, and exports against the same character form.

## Changes

- Added a shared `characterFooterActionBusy` computed state for save, delete, and export work.
- Guarded character save submit behind the shared footer busy state.
- Guarded character delete behind the shared footer busy state.
- Guarded character export behind the shared footer busy state.
- Disabled save, delete, and export footer buttons together while any one footer action is pending.
- Marked each footer button busy with its own specific loading flag.
- Extended focused CharacterFormView source coverage for the shared footer busy-state lock.

## Files Touched

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendCharacterFormView.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 497 backend tests and frontend build.

## Notes

- This leaves the existing form submit/delete/export implementations intact and only makes their entry points mutually exclusive.
