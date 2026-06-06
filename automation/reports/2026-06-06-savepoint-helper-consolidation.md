# Savepoint Helper Consolidation

## Summary

- Replaced repeated savepoint boilerplate with `withSavepoint` in branch creation, save loading, and character tag syncing.
- Added forced-failure regression tests to prove partial writes roll back for each converted path.
- Kept the change scoped to the duplicated savepoint code identified in the robustness audit.

## Changed Files

- `backend/src/modules/branches.js`
- `backend/src/modules/saves.js`
- `backend/src/modules/tags.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-06-savepoint-helper-consolidation.md`

## Validation

- Passed: `node --test src/tests/backend.test.js` from `backend` (205 tests).
- Passed: `npm.cmd test` from `backend` (320 tests).
- Passed: `git diff --check` (only CRLF normalization warnings).
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Safety Notes

- Existing unrelated worktree changes were preserved.
- `git status --short` still shows many tracked `automation/reports` files deleted and an untracked `automation/reports/archive/` directory from another cleanup. This run did not create, revert, or modify that archive cleanup.
- No data, uploads, env files, dependency folders, build output, pushes, commits, or resets were touched.

## Next Recommended Task

- Continue scanning for remaining duplicated normalization helpers in AI assistant services, then extract only the shared primitives if the current patch stack remains stable.
