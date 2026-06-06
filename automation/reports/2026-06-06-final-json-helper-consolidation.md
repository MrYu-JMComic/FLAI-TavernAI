# Final JSON Helper Consolidation

## Summary

- Updated `backend/src/services/providers.js` to import the shared `parseJson` helper from `backend/src/utils/json.js`.
- Replaced `backend/src/modules/swipes.js` local `safeParseJson` usage with `parseJson(value, null)`.
- Removed the remaining local backend JSON parse helper definitions outside the shared utility.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/modules/swipes.js`

## Validation

- `node --check src\services\providers.js` from `backend`: passed
- `node --check src\modules\swipes.js` from `backend`: passed
- `node --test src\tests\providers.test.js` from `backend`: passed, 2 tests
- `node --test src\tests\routeHelpers.test.js` from `backend`: passed, 9 tests
- `node --test src\tests\backend.test.js --test-name-pattern "swipe"` from `backend`: passed, 210 tests
- `npm.cmd test` from `backend`: passed, 337 tests
- `npm.cmd run build` from `frontend`: passed
- `git diff --check`: passed
- `Select-String ... -Pattern "function parseJson"`: only `backend/src/utils/json.js` defines `parseJson`.
- `Select-String ... -Pattern "safeParseJson"`: no matches.
- `node scripts\check-encoding.mjs`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: passed

## Notes

- The provider call sites pass strings or explicit JSON defaults, and `provider_settings.extra_body` is defined as `TEXT NOT NULL DEFAULT '{}'`, so this migration avoids observable provider behavior drift.
- `safeParseJson(row.usage_json)` behavior is preserved as `parseJson(row.usage_json, null)` for empty, null, and malformed usage JSON.
- Existing unrelated worktree changes were preserved.

## Next Recommended Task

- Continue dead-code review around small service/module-local helpers, but only migrate helpers with matching fallback semantics and nearby test coverage.
