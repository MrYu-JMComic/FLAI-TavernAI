# Economy Savepoint Helper Consolidation

## Summary

- Replaced the manual `createTransaction` savepoint boilerplate with the shared `withSavepoint` helper.
- Updated the stale economy intent comment to describe the current savepoint-based transaction boundary.
- Added a forced-failure regression test proving a failed balance update rolls back the already-inserted transaction row.

## Changed Files

- `backend/src/modules/economy.js`
- `backend/src/tests/economy.test.js`
- `automation/reports/2026-06-06-economy-savepoint-helper-consolidation.md`

## Validation

- Passed: `node --test src\tests\economy.test.js` from `backend` (56 tests).
- Passed: `npm.cmd test` from `backend` (326 tests).
- Passed: `npm.cmd run build` from `frontend`.
- Passed: `git diff --check` (only CRLF normalization warnings).
- Passed: `node scripts\check-encoding.mjs`.
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.

## Safety Notes

- Existing unrelated worktree changes were preserved.
- The pre-existing deleted `automation/reports/*` entries and untracked `automation/reports/archive/` cleanup were left untouched.
- No data, uploads, env files, dependency folders, generated build output, pushes, commits, or resets were touched.

## Next Recommended Task

- Review the remaining manual savepoint paths in `routes/regex.js` and conversation settings, and only consolidate them if a route-level rollback test can pin behavior without expanding scope.
