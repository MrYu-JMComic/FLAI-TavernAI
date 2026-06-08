# 2026-06-08 - Accessibility Native Input Name Refactor

## Scope

- Refactored `scripts/find-inaccessible-vue-controls.mjs` so native input naming exceptions are handled by one `inputHasNativeAccessibleName` helper.
- Removed the separate `inputValueProvidesName` and `inputAltProvidesName` helper shape left by successive accessibility edge-case patches.
- Kept existing behavior for button-style input `value`, image input `alt`, hidden inputs, and normal form-control label checks.
- Added structure assertions so future patches do not reintroduce split native input naming helpers.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-native-input-name-refactor.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue watching recently patched diagnostics for repeated helper shapes and consolidate them once behavior has stabilized.
