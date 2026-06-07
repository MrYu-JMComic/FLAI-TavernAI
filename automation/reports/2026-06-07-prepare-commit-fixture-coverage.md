# 2026-06-07 Prepare Commit Fixture Coverage

## Goal

Turn the staged `scripts/prepare-commit.ps1` single-path array fix into a
repeatable regression test instead of relying on one manual staging run.

## Change

- Added a `validation-scripts.test.js` fixture that creates an isolated Git
  repository, copies `prepare-commit.ps1`, commits a baseline, then stages one
  tracked modification plus one allowed untracked file.
- Verified the script stages `tracked.txt` and `untracked.txt` as separate
  targets.

## Files Touched

- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-prepare-commit-fixture-coverage.md`

## Validation

- `node --test backend\src\tests\validation-scripts.test.js`: PASS; 8 tests
  passed.
- `node scripts/check-encoding.mjs`: PASS; scanned 504 files.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS;
  450 backend tests passed and frontend build completed.

## Notes

No production staging logic was changed in this iteration. The existing fix is
now protected by an executable fixture rather than another static assertion.
