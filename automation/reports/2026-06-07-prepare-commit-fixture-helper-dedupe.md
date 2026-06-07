# 2026-06-07 Prepare Commit Fixture Helper Dedupe

## Goal

Keep the new `prepare-commit.ps1` regression tests from becoming copied fixture
setup.

## Change

- Extracted the repeated temporary Git repository setup into
  `createPrepareCommitFixture()`.
- Extracted the repeated PowerShell invocation into `runPrepareCommitAll()`.
- Extracted staged-path inspection into `getStagedPaths()`.
- Kept the existing single tracked plus untracked and comma-path assertions
  unchanged.

## Files Touched

- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-prepare-commit-fixture-helper-dedupe.md`

## Validation

- `node --test backend\src\tests\validation-scripts.test.js`: PASS; 9 tests
  passed.
- `node scripts/check-encoding.mjs`: PASS; scanned 509 files.
- `npm run build` in `frontend`: PASS; Vite production build completed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS;
  453 backend tests passed and frontend build completed.

## Notes

This is a test-maintenance refactor only; no production staging behavior was
changed.
