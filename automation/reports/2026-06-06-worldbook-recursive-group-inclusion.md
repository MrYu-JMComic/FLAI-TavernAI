# World Book Recursive Group Inclusion

Date: 2026-06-06

## Summary

- Extracted world book inclusion-group pruning into `applyGroupInclusion`.
- Reapplied inclusion-group pruning after recursive world book activation so recursively triggered entries cannot bypass the one-entry-per-group rule.
- Adjusted the recursive stop condition to continue when a new unscanned matched entry survives group pruning, even if the total match count stays the same.
- Added regression coverage for a recursive trigger that tries to add a second entry from the same inclusion group.

## Changed Files

- `backend/src/modules/worldBooks.js`
- `backend/src/tests/backend.test.js`

## Validation

- `node --check src\modules\worldBooks.js` in `backend`: passed
- `node --test --test-name-pattern "world book group inclusion|world book recursive activation preserves group inclusion|world book alwaysActive|world book sticky" src\tests\backend.test.js` in `backend`: passed, 5 tests
- `npm.cmd test` in `backend`: passed, 362 tests
- `git diff --check`: passed, with Windows line-ending warnings only
- `node scripts\check-encoding.mjs`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including backend tests and frontend build

## Notes

- Existing parallel frontend, conversation, economy, user, regex, character, schema, plan, and prior report changes were preserved.
- This report covers only the world book recursive inclusion-group pruning fix.

## Next Recommended Task

- Continue reviewing world book recursive activation and token budget ordering for narrow edge cases where intermediate matches can affect final prompt content.
