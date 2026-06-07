# 2026-06-07 SFC Test Block Helper Hygiene Guard

## Goal

Prevent repeated Vue SFC source-test block loading from creeping back after consolidating tests on the shared helper.

## Changes

- Added `findDirectVueBlockReadViolations()` to `backend/src/tests/source-hygiene.test.js`.
- Added a source hygiene test that fails if backend tests directly use `readVueBlock` outside `frontendSfcTestUtils.js`.
- Confirmed the current test tree only uses `readVueBlock()` inside the shared helper.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/tests/source-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-sfc-test-block-helper-hygiene-guard.md`

## Validation

- Passed: `node --test backend\src\tests\source-hygiene.test.js`
- Passed: `rg "readVueBlock\(" backend/src/tests -n` shows direct calls only in `backend/src/tests/frontendSfcTestUtils.js`.
- Passed: `node scripts\check-encoding.mjs`
- Passed: `git diff --check` with LF/CRLF conversion warnings only and no whitespace errors.
- Passed: `git diff --cached --check`
- Passed: `npm run build` in `frontend`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (509 backend/source tests and frontend build)

## Notes

- This is a test-maintenance guard only; no product runtime code changed.
- Existing parallel Chat, Settings, StatusBar, backend route, and report worktree changes were preserved.
