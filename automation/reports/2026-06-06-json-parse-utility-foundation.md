# JSON Parse Utility Foundation

## Summary

- Added `backend/src/utils/json.js` with the shared `parseJson` fallback helper.
- Updated `backend/src/routes/helpers.js` to use and re-export the shared helper for compatibility.
- Updated `backend/src/modules/conversationAppearance.js` to use the shared helper and removed its duplicate local implementation.

## Changed Files

- `backend/src/utils/json.js`
- `backend/src/routes/helpers.js`
- `backend/src/modules/conversationAppearance.js`

## Validation

- `rg "function parseJson\(value, fallback\)|export function parseJson\(value, fallback\)" -n backend\src`: confirmed the duplicate implementation count was reduced by one and `backend/src/utils/json.js` is now the shared implementation.
- `node --check src\utils\json.js` from `backend`: passed
- `node --check src\routes\helpers.js` from `backend`: passed
- `node --check src\modules\conversationAppearance.js` from `backend`: passed
- `node --test src\tests\routeHelpers.test.js` from `backend`: passed, 9 tests
- `npm.cmd test` from `backend`: passed, 337 tests
- `npm.cmd run build` from `frontend`: passed

## Notes

- This keeps route helper `parseJson` compatibility while establishing the lower-level utility module for future migrations.
- Remaining local `parseJson` implementations should be migrated only in small slices with nearby tests or full backend coverage.
- Existing unrelated worktree changes were preserved.

## Next Recommended Task

- Migrate the next identical `parseJson` helper from a small module such as `talents`, `saves`, or `statusBars` after confirming coverage.
