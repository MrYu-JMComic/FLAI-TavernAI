# 2026-06-07 Character Form AI Action Busy Lock

## Goal

Prevent CharacterFormView AI draft actions from overlapping with each other, form saves, or read-only character state.

## Changes

- Added a shared `characterAiActionBusy` computed state for main AI, advanced AI, saving, and edit permission.
- Guarded the main character AI completion handler behind the shared busy state.
- Guarded the advanced-settings AI completion handler behind the same busy state.
- Disabled main AI requirement/model/options controls while any character AI action is busy.
- Disabled the advanced AI controls and marked both AI action buttons busy with their specific loading flags.
- Added focused source coverage for the shared AI busy-state lock.

## Files Touched

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendCharacterFormView.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 494 backend tests and frontend build.

## Notes

- Stop buttons remain available while their own stream is active, so users can still pause an in-flight AI request.
