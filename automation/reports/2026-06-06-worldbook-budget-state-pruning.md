# World Book Budget State Pruning

Date: 2026-06-06

## Summary

- Moved world book entry state updates after token-budget pruning.
- Rebuilt the active entry id set from the final matched entries so sticky/cooldown state only follows entries that survive final prompt pruning.
- Added regression coverage proving a sticky entry trimmed by token budget does not become active on the next match call.

## Changed Files

- `backend/src/modules/worldBooks.js`
- `backend/src/tests/backend.test.js`

## Validation

- `node --check src\modules\worldBooks.js` in `backend`: passed
- `node --test --test-name-pattern "world book token budget|world book sticky|world book recursive activation preserves group inclusion" src\tests\backend.test.js` in `backend`: passed, 5 tests
- `npm.cmd test` in `backend`: passed, 363 tests
- `git diff --check`: passed, with Windows line-ending warnings only
- `node scripts\check-encoding.mjs`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including backend tests and frontend build

## Notes

- Existing parallel frontend, conversation, economy, user, regex, character, schema, plan, route, and prior report changes were preserved.
- This report covers only the world book token-budget state pruning fix.

## Next Recommended Task

- Continue reviewing world book option normalization, especially `contextSize`, so non-finite caller overrides cannot distort pruning behavior.
