# 2026-06-07 Preset List Action Busy Freeze

## Goal

Prevent PresetView list controls from opening stale create/edit states while preset loading, saving refreshes, deletes, or default changes are still pending.

## Changes

- Added a shared `presetListActionBusy` computed state for list loading and preset mutations.
- Guarded create, edit, delete, and set-default entry handlers behind the shared busy state.
- Disabled and marked busy the list create, default, and delete controls while preset work is pending.
- Added a busy visual state for preset cards so guarded card clicks do not look active.
- Added focused source coverage for the PresetView list busy-state lock.

## Files Touched

- `frontend/src/views/PresetView.vue`
- `backend/src/tests/frontendPresetView.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendPresetView.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 490 backend tests and frontend build.

## Notes

- Navigation back to Home remains available while preset work is pending; only list actions that enter or mutate preset state are frozen.
