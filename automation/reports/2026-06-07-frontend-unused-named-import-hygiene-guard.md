# 2026-06-07 Frontend Unused Named Import Hygiene Guard

## Goal

Extend dead-import hygiene coverage to frontend source without breaking normal Vue template component usage.

## Changes

- Added frontend source coverage to the unused named-import hygiene guard.
- Counted kebab-case Vue component tags, such as `<fancy-widget>`, as valid usage for PascalCase named imports.
- Kept fixture-string pseudo-imports ignored by scanning masked source and masking the import declaration before usage counts.
- Added focused source hygiene coverage for Vue kebab-case component usage.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/tests/source-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-frontend-unused-named-import-hygiene-guard.md`

## Validation

- Passed: `node --test backend\src\tests\source-hygiene.test.js` (17 tests)
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (515 backend/source tests and frontend build)

## Notes

- This is a source hygiene guard only; no product runtime code changed.
- Existing parallel Chat, Settings, StatusBar, backend route, and report worktree changes were preserved.
