# 2026-06-07 Character Image Retry Loading Guard

## Goal

Prevent CharacterImagePanel retry clicks from starting redundant image refreshes while the current character image list is already loading.

## Changes

- Added a dedicated `retryLoadImages()` entry point that ignores retry events while `loading` is active.
- Routed the error-state retry button through the guarded retry entry point.
- Added `aria-busy` to the retry button so the visible state matches the guarded behavior.
- Added focused source coverage for the retry guard and retry button binding.

## Files Touched

- `frontend/src/components/CharacterImagePanel.vue`
- `backend/src/tests/frontendCharacterImagePanel.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendCharacterImagePanel.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `git diff --cached --check` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 495 backend/source tests and frontend build.

## Notes

- `loadImages()` itself remains reusable for character switches and mutation refreshes; only the user retry entry point is blocked while loading.
- CharacterFormView/auth/settings/preset/world-book working-tree changes were already present during validation and were left untouched.
