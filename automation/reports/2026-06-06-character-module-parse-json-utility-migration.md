# Character Module parseJson Utility Migration

## Summary

- Updated `backend/src/modules/characters.js` to import the shared `parseJson` helper from `backend/src/utils/json.js`.
- Removed the duplicate local `parseJson` implementation from the character module.
- Preserved legacy tag, render plugin, and author advanced settings JSON parsing behavior while reducing repeated helper code.

## Changed Files

- `backend/src/modules/characters.js`

## Validation

- `node --check src\modules\characters.js` from `backend`: passed
- `node --test src\tests\backend.test.js --test-name-pattern "character|Character|render plugin|advanced settings|tags"` from `backend`: passed, 210 tests
- `node --test src\tests\accessoryAgents.test.js --test-name-pattern "character|advanced settings|status blueprint"` from `backend`: passed, 12 tests
- `node --test src\tests\routeHelpers.test.js` from `backend`: passed, 9 tests
- `rg "function parseJson\(value, fallback\)|export function parseJson\(value, fallback\)" -n backend\src`: confirmed the duplicate implementation count was reduced and `backend/src/modules/characters.js` no longer defines a local helper.
- `npm.cmd test` from `backend`: passed, 337 tests
- `npm.cmd run build` from `frontend`: passed

## Notes

- This is a behavior-preserving migration to the shared utility.
- The remaining local `parseJson` implementation is in `services/providers`; it handles high-traffic provider protocol parsing and should be reviewed separately before migration.
- Existing unrelated worktree changes were preserved.

## Next Recommended Task

- Review `services/providers.js` to decide whether its local `parseJson` should stay local for service isolation or move to `backend/src/utils/json.js`.
