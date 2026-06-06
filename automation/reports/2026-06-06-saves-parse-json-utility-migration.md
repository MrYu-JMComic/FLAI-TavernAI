# Saves parseJson Utility Migration

## Summary

- Updated `backend/src/modules/saves.js` to import the shared `parseJson` helper from `backend/src/utils/json.js`.
- Removed the duplicate local `parseJson` implementation from the saves module.
- Preserved snapshot, usage metadata, and load-save JSON parsing behavior while reducing repeated helper code.

## Changed Files

- `backend/src/modules/saves.js`

## Validation

- `node --check src\modules\saves.js` from `backend`: passed
- `node --test src\tests\backend.test.js --test-name-pattern "saves|save|Save|snapshot|loadSave|getSave|listSaves"` from `backend`: passed, 210 tests
- `node --test src\tests\routeHelpers.test.js` from `backend`: passed, 9 tests
- `rg "function parseJson\(value, fallback\)|export function parseJson\(value, fallback\)" -n backend\src`: confirmed the duplicate implementation count was reduced and `backend/src/modules/saves.js` no longer defines a local helper.
- `npm.cmd test` from `backend`: passed, 337 tests
- `npm.cmd run build` from `frontend`: passed

## Notes

- This is a behavior-preserving migration to the shared utility.
- Remaining local `parseJson` implementations are still present in `characters`, `statusBars`, and `services/providers`; each should be migrated only after confirming scope and coverage.
- Existing unrelated worktree changes were preserved.

## Next Recommended Task

- Migrate the next small `parseJson` duplicate, likely `statusBars`, with focused syntax checks plus the full backend suite.
