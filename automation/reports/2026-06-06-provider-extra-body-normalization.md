# Provider Extra Body Normalization

## Summary

- Exported `normalizeProviderExtraBody` from `backend/src/services/providers.js` and reused it anywhere provider request extra body values are merged.
- Updated `backend/src/routes/settings.js` to parse string `extraBody` values through the shared JSON helper and normalize the result to a plain object before saving or probing models.
- Added a settings route regression test that submits a JSON array string for `extraBody` and verifies the persisted provider setting is `{}`.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/routes/settings.js`
- `backend/src/tests/backend.test.js`

## Validation

- `rg "providerExtraBody|normalizeProviderExtraBody" backend\src\services\providers.js backend\src\routes\settings.js backend\src\tests\backend.test.js`: passed; only the exported helper name remains.
- `node --check src\services\providers.js` from `backend`: passed
- `node --check src\routes\settings.js` from `backend`: passed
- `node --check src\tests\backend.test.js` from `backend`: passed
- `node --test src\tests\backend.test.js --test-name-pattern "provider settings route normalizes|string extra body|buildProviderBody ignores non-object extra body values|provider settings schema"` from `backend`: passed, 211 tests
- `npm.cmd test` from `backend`: passed, 338 tests
- `npm.cmd run build` from `frontend`: passed
- `git diff --check`: passed
- `node scripts\check-encoding.mjs`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: passed

## Notes

- This keeps the existing provider request behavior while making settings persistence stricter: arrays, invalid JSON strings, primitives, and non-plain objects normalize to `{}`.
- The route still accepts valid stringified JSON objects for form-style clients.
- Existing unrelated worktree changes were preserved.

## Next Recommended Task

- Continue reviewing backend route-local parsing and normalization helpers for cases where route persistence accepts broader values than the downstream service contract.
