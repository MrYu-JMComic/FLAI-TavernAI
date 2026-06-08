# 2026-06-08 Review Gate Node Helper

## Summary

Routed the remaining Node-based review-gate checks through the shared native command helper so encoding, unreferenced Vue component, accessibility, backend test, frontend build, and Git diff checks all use one logged execution path.

## Changed Files

- `scripts/review-gate.ps1`
  - Replaced raw `node ... 2>&1 | Write-Host` calls for encoding and diagnostic stages with `Invoke-LoggedNativeCommand`.
  - Preserved non-blocking behavior for the Vue diagnostics while keeping output and exit-code handling consistent.
- `backend/src/tests/validation-scripts.test.js`
  - Added source-level coverage that the Node review-gate stages use the shared helper.
  - Tightened the review-gate contract so direct `$LASTEXITCODE -ne 0` checks are not reintroduced outside the helper path.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test backend\src\tests\validation-scripts.test.js`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 642 passed, 0 failed.
  - Frontend build: passed.

## Notes

- Existing unrelated and parallel worktree changes were left in place.
- No protected paths were intentionally touched.

## Next Recommended Task

Audit `scripts/review-gate.ps1` for any remaining raw native command calls that should either stay intentionally simple, such as `git status --short`, or be documented as intentionally outside the shared helper.
