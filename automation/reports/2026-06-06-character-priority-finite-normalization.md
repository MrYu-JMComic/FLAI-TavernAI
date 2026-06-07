# Character Priority Finite Normalization

Date: 2026-06-06

## Summary

- Reused the shared `normalizeFiniteNumber` helper for character regex rule `priority` normalization.
- Preserved the existing behavior of rounding numeric priorities and clamping negative values to `0`.
- Added a regression assertion so string `"Infinity"` is stored as priority `0` instead of a non-finite priority value.

## Changed Files

- `backend/src/modules/characters.js`
- `backend/src/tests/characters-normalize.test.js`

## Validation

- `node --check src\modules\characters.js` in `backend`: passed
- `node --test src\tests\characters-normalize.test.js` in `backend`: 2 passed
- `npm.cmd test` in `backend`: 355 passed
- `git diff --check`: passed, with existing Windows line-ending warnings
- `node scripts\check-encoding.mjs`: passed
- `npm.cmd run build` in `frontend`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including backend tests and frontend build

## Notes

- Existing unrelated frontend, conversation, economy, world book, schema, and prior report changes were preserved.
- A remaining candidate for a later iteration is reviewing `backend/src/routes/regex.js` import priority/order normalization for consistent clamping, after checking backward compatibility.
