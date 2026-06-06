# Character Regex Savepoint Consolidation

## Summary

- Replaced the remaining manual regex savepoint boilerplate in `characters.js` with the shared `withSavepoint` helper.
- Added rollback regression tests for regex replacement and regex priority reorder failures.
- Kept the slice scoped to character regex persistence so the broader patch stack stays reviewable.

## Changed Files

- `backend/src/modules/characters.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-06-character-regex-savepoint-consolidation.md`

## Validation

- Passed: `node --test src/tests/backend.test.js` from `backend` (207 tests).
- Passed: `npm.cmd test` from `backend` (324 tests).
- Passed: `npm.cmd run build` from `frontend`.
- Passed: `git diff --check` (only CRLF normalization warnings).
- Passed: `node scripts/check-encoding.mjs`.
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Safety Notes

- Existing unrelated worktree changes were preserved.
- The pre-existing deleted `automation/reports/*` entries and untracked `automation/reports/archive/` cleanup were left untouched.
- No data, uploads, env files, dependency folders, generated build output, pushes, commits, or resets were touched.

## Next Recommended Task

- Continue with one remaining manual savepoint path, likely `swipes`, `economy`, or the regex import route, only if a focused rollback test can pin the behavior.
