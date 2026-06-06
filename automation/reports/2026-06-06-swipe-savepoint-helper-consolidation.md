# Swipe Savepoint Helper Consolidation

## Summary

- Replaced the manual `setActiveSwipe` savepoint boilerplate with the shared `withSavepoint` helper.
- Added a forced-failure regression test proving a failed active swipe update does not leave behind the temporary saved current-message swipe.
- Kept the change scoped to the swipe activation write path.

## Changed Files

- `backend/src/modules/swipes.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-06-swipe-savepoint-helper-consolidation.md`

## Validation

- Passed: `node --test src\tests\backend.test.js` from `backend` (208 tests).
- Passed: `npm.cmd test` from `backend` (325 tests).
- Passed: `npm.cmd run build` from `frontend`.
- Passed: `git diff --check` (only CRLF normalization warnings).
- Passed: `node scripts\check-encoding.mjs`.
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.

## Safety Notes

- Existing unrelated worktree changes were preserved.
- The pre-existing deleted `automation/reports/*` entries and untracked `automation/reports/archive/` cleanup were left untouched.
- No data, uploads, env files, dependency folders, generated build output, pushes, commits, or resets were touched.

## Next Recommended Task

- Continue consolidating a remaining manual savepoint path only where a focused rollback test can pin behavior, likely `economy.js` or `routes/regex.js`.
