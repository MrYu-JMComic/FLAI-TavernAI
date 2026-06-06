# Request Boolean Normalization

## Summary

- Added `backend/src/utils/boolean.js` with `normalizeBoolean` for request payload flags.
- Updated character reaction and image routes to parse string boolean values such as `"false"` without treating them as truthy.
- Updated provider settings/model probe routes to use the same normalization for `supportsReasoning` and `forceRefresh`.
- Added route regression tests for character reactions, character image default toggles, and provider model probe cache behavior with `forceRefresh: "false"`.

## Changed Files

- `backend/src/utils/boolean.js`
- `backend/src/routes/characters.js`
- `backend/src/routes/settings.js`
- `backend/src/tests/backend.test.js`
- `backend/src/tests/utils.test.js`

## Validation

- `node --check src\utils\boolean.js` from `backend`: passed
- `node --check src\routes\characters.js` from `backend`: passed
- `node --check src\routes\settings.js` from `backend`: passed
- `node --check src\tests\backend.test.js` from `backend`: passed
- `node --test src\tests\utils.test.js` from `backend`: passed, 2 tests
- `node --test src\tests\backend.test.js --test-name-pattern "character routes normalize string boolean flags|provider model probe treats string false forceRefresh|provider settings route normalizes|saveProviderSettings encrypts API key"` from `backend`: passed, 213 tests
- `npm.cmd test` from `backend`: passed, 342 tests
- `npm.cmd run build` from `frontend`: passed
- `git diff --check`: passed
- `node scripts\check-encoding.mjs`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: passed

## Notes

- This specifically fixes the JavaScript truthiness trap where `"false"` was previously treated as true for route request bodies.
- Database row normalization and existing internal boolean conversions were left untouched.
- Existing unrelated worktree changes were preserved.

## Next Recommended Task

- Continue reviewing route request-body normalization for other primitive coercion cases, especially numeric fields that currently use broad `Number(...) || fallback` patterns.
