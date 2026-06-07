# 2026-06-07 Source Hygiene Regex Escape Helper

## Goal

Keep the expanded source hygiene guard maintainable by removing repeated regular-expression escaping snippets.

## Changes

- Added `escapeRegExp()` to centralize literal-to-regex escaping.
- Reused the helper in identifier and Vue template component tag usage checks.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/tests/source-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-source-hygiene-regex-escape-helper.md`

## Validation

- Passed: `node --test backend\src\tests\source-hygiene.test.js` (21 tests)
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (522 backend/source tests and frontend build)

## Notes

- This is a source hygiene maintenance refactor only; no product runtime code changed.
- Existing parallel ChatSidebar, HomeView, WorldBookView, Chat, Settings, StatusBar, backend route, and report worktree changes were preserved.
