# Accessibility Attribute Helper Loops

## Summary

Reused direct `for...of` loops in the Vue accessibility diagnostic attribute helpers instead of `names.some(...)` callbacks. This keeps bound and static accessible-name checks on the cached helper path without allocating callback closures in the repeated scanner hot path.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
  - Changed `hasBoundAttribute()` to scan requested names with a direct loop over cached bound-attribute patterns.
  - Changed `hasNonEmptyStaticAttribute()` to scan requested names with a direct loop over the shared static attribute reader.
- `backend/src/tests/validation-scripts.test.js`
  - Updated the scanner source contract to require the direct helper loops.
  - Added guards against returning to the previous `names.some(...)` forms.
- `automation/backlog.md`
  - Recorded this completed iteration.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Result: `violations: []`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend test suite passed: 675 tests.
  - Frontend build passed.
  - Git status check completed.

## Next Recommended Task

Keep the next iteration narrow while the worktree is heavily dirty. Another scanner-only source hygiene pass is reasonable, but avoid business-code rewrites until the parallel changes are reviewed.
