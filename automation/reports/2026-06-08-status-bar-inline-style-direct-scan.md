# 2026-06-08 Status Bar Inline Style Direct Scan

## Goal

Reduce temporary allocations in status-bar custom-template inline style sanitizing while preserving safe CSS declaration text.

## Changed Files

- `frontend/src/utils/statusBarTemplateSecurity.js`
- `backend/src/tests/frontendStatusBarTemplateSecurity.test.js`
- `automation/backlog.md`

## Changes

- Replaced inline style `split/map/filter/join` sanitizing with one direct declaration scanner.
- Preserved semicolons inside quoted CSS values so safe custom labels are not split into broken declarations.
- Continued dropping dangerous declarations through the shared status-bar CSS detector.
- Added a focused behavior test and source guards against the old allocation pipeline.

## Validation

- PASS: `node --test backend\src\tests\frontendStatusBarTemplateSecurity.test.js` (5 tests passed)
- PASS: `node scripts\check-encoding.mjs` (scanned 507 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (814 backend/source tests passed; frontend build passed)

## Next

- Continue with focused status/UI refresh helpers that have existing source coverage before broad UI rewrites.
