# 2026-06-07 Duplicate Test Name Hygiene Guard

## Goal

Prevent patch-overlap drift where copied backend tests keep the same name and make failures or coverage intent harder to read.

## Changes

- Added `findDuplicateTestNameViolations()` to source hygiene checks.
- Limited the guard to backend test files and reused masked source so comments and string fixtures do not count as real tests.
- Added focused fixture coverage proving duplicate test names are detected while comment/string examples are ignored.
- Added a full backend test-tree assertion that each file has unique test names.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/tests/source-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-duplicate-test-name-hygiene-guard.md`

## Validation

- Passed: `node --test backend\src\tests\source-hygiene.test.js` (21 tests)
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (522 backend/source tests and frontend build)

## Notes

- This is a test hygiene guard only; no product runtime code changed.
- Existing parallel HomeView, WorldBookView, ChatSidebar, Chat, Settings, StatusBar, backend route, and report worktree changes were preserved.
