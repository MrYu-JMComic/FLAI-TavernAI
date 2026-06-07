# 2026-06-07 Frontend SFC Test Block Helper

## Goal

Reduce repeated source-test setup left by multiple frontend guard patches without changing product behavior.

## Changes

- Added `readVueBlocks()` to the shared frontend SFC source-test helper.
- Migrated auth view, character image panel, and message toast source tests to the shared block reader.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/tests/frontendSfcTestUtils.js`
- `backend/src/tests/frontendAuthViews.test.js`
- `backend/src/tests/frontendCharacterImagePanel.test.js`
- `backend/src/tests/frontendMessageToasts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-frontend-sfc-test-block-helper.md`

## Validation

- Passed: `node --test backend\src\tests\frontendSfcTestUtils.js backend\src\tests\frontendAuthViews.test.js backend\src\tests\frontendCharacterImagePanel.test.js backend\src\tests\frontendMessageToasts.test.js`
- Passed: `node scripts\check-encoding.mjs`
- Passed: `git diff --check` with LF/CRLF conversion warnings only and no whitespace errors.
- Passed: `git diff --cached --check`
- Passed: `npm run build` in `frontend`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` after a transient concurrent Settings test mismatch was no longer present (504 backend/source tests and frontend build)

## Notes

- This is a test-maintenance refactor only; no frontend component, route, or backend runtime code changed.
- Existing parallel Chat and Settings worktree changes were preserved.
