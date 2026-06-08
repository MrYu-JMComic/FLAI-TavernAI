# 2026-06-08 CharacterForm Accessory Default Direct Loop

## Goal

Keep CharacterFormView advanced-settings merge checks cheap and consistent with the existing direct defaults-loop payload normalization.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`

## Changes

- Replaced `Object.keys(defaults).some(...)` in `hasNonDefaultAccessorySkills` with a guarded `for...in` scan over default accessory skill keys.
- Preserved short-circuit behavior for changed enabled states and model overrides.
- Added source-test coverage for the direct defaults loop and a guard against restoring the `Object.keys(defaults).some(...)` allocation path.

## Validation

- PASS: `node --test backend\src\tests\frontendCharacterFormView.test.js` (14 tests)
- PASS: `node --test backend\src\tests\frontendCharacterFormView.test.js backend\src\tests\frontendExtensionHooks.test.js` (16 tests)
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (805 backend tests, frontend build)

## Next

- Review remaining user-facing result-label helpers that still count object keys with array allocation.
