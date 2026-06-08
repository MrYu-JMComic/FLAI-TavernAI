# Encoding Check Suspicious Char Set Loop

## Summary

Changed the UTF-8 encoding checker to populate the suspicious-character `Set` with a direct loop instead of `suspiciousCodePoints.map(...)`. This avoids a temporary startup array while keeping the same mojibake marker coverage.

## Changed Files

- `scripts/check-encoding.mjs`
  - Replaced `new Set(suspiciousCodePoints.map(...))` with direct `Set` construction and `add()` calls.
- `backend/src/tests/validation-scripts.test.js`
  - Updated the encoding checker source contract to require the direct loop.
  - Added a guard against returning to `suspiciousCodePoints.map`.
- `automation/backlog.md`
  - Recorded this completed iteration.

## Validation

- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 345 files; no common Chinese mojibake markers found.
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend test suite passed: 674 tests.
  - Frontend build passed.
  - Git status check completed.

## Next Recommended Task

Continue small source-hygiene passes in diagnostic scripts or test isolation while the worktree remains heavily dirty. Avoid broad refactors until the current parallel changes are reviewed.
