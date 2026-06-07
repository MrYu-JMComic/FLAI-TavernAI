# 2026-06-07 Unused Tag Lookup Export Cleanup

## Goal

Remove a verified unused internal backend export without changing tag behavior or broad module boundaries.

## Changes

- Removed the unused `getTagByName` export from `backend/src/modules/tags.js`.
- Verified repository references no longer include `getTagByName`.
- Left the separately detected `createRegexRuleSchema` candidate for a later cleanup because `backend/src/validations/schemas.js` currently has mixed line endings and should not be churned during this small iteration.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/modules/tags.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-unused-tag-lookup-export-cleanup.md`

## Validation

- Passed: `node --test backend\src\tests\backend.test.js backend\src\tests\tagListLimit.test.js` (242 tests)
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (532 backend/source tests and frontend build)

## Notes

- Product behavior is unchanged; this only removes an unreferenced helper export.
- Existing parallel HomeView, ChatComposer, style, backlog, and report worktree changes were preserved.
