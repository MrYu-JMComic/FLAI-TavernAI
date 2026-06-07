# 2026-06-07 Preset Retry Loading Guard

## Goal

Prevent the PresetView error-state retry action from starting overlapping preset list refreshes while a refresh is already pending.

## Changes

- Added an in-flight early return to the `loadPresets()` entry point without blocking the initial mounted load.
- Disabled and marked the error-state retry button busy while presets are loading.
- Added focused source coverage for the retry guard and its visible disabled state.

## Files Touched

- `frontend/src/views/PresetView.vue`
- `backend/src/tests/frontendPresetView.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendPresetView.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `git diff --cached --check` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 492 backend/source tests and frontend build.

## Notes

- The guard uses a separate in-flight flag because `loading` starts as `true` to show the initial spinner before the mounted load begins.
- Login/register busy-state changes were already present in the working tree during validation and were left untouched.
