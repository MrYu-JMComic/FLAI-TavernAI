# Regex Import Savepoint Helper Consolidation

## Summary

- Replaced the manual regex import route savepoint boilerplate with the shared `withSavepoint` helper.
- Added a route-level forced-failure regression test proving a later import insert failure rolls back earlier imported rules.
- Kept the change scoped to the existing `/api/regex/import` atomic insert path.

## Changed Files

- `backend/src/routes/regex.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-06-regex-import-savepoint-helper-consolidation.md`

## Validation

- Passed: `node --test src\tests\backend.test.js` from `backend` (209 tests).
- Passed: `npm.cmd test` from `backend` (327 tests).
- Passed: `npm.cmd run build` from `frontend`.
- Passed: `git diff --check` (CRLF normalization warnings only).
- Passed: `node scripts\check-encoding.mjs`.
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.

## Safety Notes

- Existing unrelated worktree changes were preserved.
- The pre-existing deleted `automation/reports/*` entries and untracked `automation/reports/archive/` cleanup were left untouched.
- No data, uploads, env files, dependency folders, generated build output, pushes, commits, or resets were touched.

## Next Recommended Task

- Review the remaining conversation settings savepoint path and consolidate only if the existing route-level settings rollback tests can be extended without broadening scope.
