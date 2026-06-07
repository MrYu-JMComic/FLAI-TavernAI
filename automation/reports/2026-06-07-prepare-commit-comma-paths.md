# 2026-06-07 Prepare Commit Comma Paths

## Goal

Remove stale path-splitting behavior from `scripts/prepare-commit.ps1` after
the single-item array handling fix made comma splitting unnecessary.

## Change

- Simplified `Get-UniquePaths` so each PowerShell argument is normalized as one
  path instead of splitting strings on commas.
- Added a fixture test that stages one tracked file and one untracked file whose
  names both contain commas.
- Kept the existing single tracked plus untracked fixture to prove the earlier
  PowerShell array fix still works.

## Files Touched

- `scripts/prepare-commit.ps1`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-prepare-commit-comma-paths.md`

## Validation

- `node --test backend\src\tests\validation-scripts.test.js`: PASS; 9 tests
  passed.
- `node scripts/check-encoding.mjs`: PASS; scanned 505 files.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS;
  452 backend tests passed and frontend build completed.

## Notes

This reduces special-case path parsing rather than adding another compatibility
layer. `-Path` remains a PowerShell string array parameter, so multiple paths
should be passed as multiple arguments rather than a quoted comma-separated
string.
