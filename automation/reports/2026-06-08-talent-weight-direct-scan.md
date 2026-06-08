# 2026-06-08 Talent Weight Direct Scan

## Goal

Finish the in-progress talent roll performance change that was blocking the review gate.

## Changed Files

- `backend/src/modules/talents.js`
- `backend/src/tests/talentsSource.test.js`
- `automation/backlog.md`

## Changes

- Kept `weightedRandomPick` on two direct loops so talent rolls no longer build weighted temporary arrays.
- Replaced the brittle source-test function match with marker-based slicing so comments between exports do not break the guard.
- Added source assertions that reject the old `talents.map(...)` and `reduce(...)` weighting path.

## Validation

- PASS: `node --test backend\src\tests\talentsSource.test.js` (1 test passed)
- PASS: `node scripts\check-encoding.mjs` (scanned 507 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (814 backend/source tests passed; frontend build passed)

## Next

- Keep any further talent cleanup focused on observable no-op refreshes or allocation-heavy paths with direct behavior coverage.
