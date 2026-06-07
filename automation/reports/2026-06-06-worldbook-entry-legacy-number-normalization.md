# World Book Entry Legacy Number Normalization

Date: 2026-06-06

## Summary

- Normalized legacy persisted world book entry number fields when entries are read back through `toEntry`.
- Reused the same normalization path when matched entries are returned from sticky, always-active, and normal trigger passes.
- Normalized delay, cooldown, sticky, probability, selective logic, role, and group weight during matching so corrupted persisted values do not leak into runtime behavior.
- Added coverage for a manually corrupted legacy row to prove read output and match output stay clamped/defaulted.

## Changed Files

- `backend/src/modules/worldBooks.js`
- `backend/src/tests/backend.test.js`

## Validation

- `node --check src\modules\worldBooks.js` in `backend`: passed
- `node --test --test-name-pattern "world book entry numeric fields|world book blank probability|world book group inclusion|world book sticky|world book cooldown|world book delay" src\tests\backend.test.js` in `backend`: passed, 7 tests
- `npm.cmd test` in `backend`: passed, 361 tests
- `git diff --check`: passed, with Windows line-ending warnings only
- `node scripts\check-encoding.mjs`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including backend tests and frontend build

## Notes

- Existing parallel frontend, conversation, economy, user, regex, character, schema, plan, and prior report changes were preserved.
- This report covers only the world book legacy entry number normalization pass.

## Next Recommended Task

- Continue scanning world book matching/state code for duplicated numeric normalization paths that can be collapsed without changing behavior.
