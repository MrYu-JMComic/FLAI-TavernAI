# 2026-06-08 AI Tool Result Own-Key Count Helper

## Goal

Keep AI tool-result labels allocation-light without duplicating helper code across CharacterFormView and WorldBookView.

## Changed Files

- `frontend/src/utils/objectKeys.js`
- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/views/WorldBookView.vue`
- `backend/src/tests/frontendObjectKeys.test.js`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `backend/src/tests/frontendWorldBookView.test.js`
- `automation/backlog.md`

## Changes

- Added a shared `countOwnObjectKeys` helper that counts enumerable own keys with a direct `for...in` scan.
- Routed CharacterFormView and WorldBookView AI tool-result applied-count labels through the shared helper instead of `Object.keys(...).length`.
- Updated source tests to require the shared helper import and added focused utility coverage for inherited and non-enumerable keys.

## Validation

- PASS: `node --test backend\src\tests\frontendObjectKeys.test.js backend\src\tests\frontendCharacterFormView.test.js backend\src\tests\frontendWorldBookView.test.js` (23 tests passed)
- PASS: `node scripts/check-encoding.mjs` (scanned 496 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (807 backend/source tests passed; frontend build passed)

## Next

- Continue consolidating repeated direct-scan helpers only when sharing reduces duplication without widening behavior.
