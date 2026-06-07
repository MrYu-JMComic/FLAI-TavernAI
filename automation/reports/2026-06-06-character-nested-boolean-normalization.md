# Character Nested Boolean Normalization

Date: 2026-06-06

## Summary

- Normalized character regex rule `enabled` and `scriptMode` values with the shared `normalizeBoolean` helper.
- Normalized character render plugin `enabled` values with the same helper.
- Extended character normalization tests so string `"false"` no longer behaves as enabled for nested character settings.

## Changed Files

- `backend/src/modules/characters.js`
- `backend/src/tests/characters-normalize.test.js`

## Validation

- `node --check src\modules\characters.js` in `backend`: passed
- `node --test src\tests\characters-normalize.test.js` in `backend`: 2 passed
- `npm.cmd test` in `backend`: 355 passed
- `git diff --check`: passed, with existing Windows line-ending warnings
- `node scripts\check-encoding.mjs`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including backend tests and frontend build

Frontend build was run by the review gate and passed.

## Notes

- Existing unrelated frontend, conversation, economy, world book, schema, and prior report changes were preserved.
- A remaining candidate for a later small iteration is numeric normalization for `priority` in `backend/src/modules/characters.js`.
