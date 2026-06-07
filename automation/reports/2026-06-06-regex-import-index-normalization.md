# Regex Import Index Normalization

Date: 2026-06-06

## Summary

- Reused `normalizeFiniteNumber` for regex import `order` and `priority` values.
- Clamped imported negative `orderIndex` and `priority` values to `0`.
- Preserved the existing fallback behavior where non-finite imported values use the import item index.
- Extended the regex import route regression test to cover string booleans, negative numeric values, and `"Infinity"` fallback values in one import request.

## Changed Files

- `backend/src/routes/regex.js`
- `backend/src/tests/backend.test.js`

## Validation

- `node --check src\routes\regex.js` in `backend`: passed
- `node --test src\tests\backend.test.js` in `backend`: 221 passed
- `npm.cmd test` in `backend`: 355 passed
- `git diff --check`: passed, with existing Windows line-ending warnings
- `node scripts\check-encoding.mjs`: passed
- `npm.cmd run build` in `frontend`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including backend tests and frontend build

## Notes

- Existing unrelated frontend, conversation, economy, world book, character, schema, and prior report changes were preserved.
- Current worktree includes additional frontend changes from outside this iteration; they were not modified by this run.
