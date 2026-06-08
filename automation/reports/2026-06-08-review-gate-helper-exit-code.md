# 2026-06-08 Review Gate Helper Exit Code

## Summary

Hardened the shared review-gate native command helper so command startup failures and null native exit-code states cannot accidentally reuse a stale `$LASTEXITCODE` value.

## Changed Files

- `scripts/review-gate.ps1`
  - Initializes the helper exit code to failure before running a native command.
  - Resolves the requested command with `Get-Command` before invocation.
  - Converts null `$LASTEXITCODE` to a successful zero only after the command invocation completes.
- `backend/src/tests/validation-scripts.test.js`
  - Added source-level coverage for the helper's default failure state, command resolution, and null-exit-code guard.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test backend\src\tests\validation-scripts.test.js`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 643 passed, 0 failed.
  - Frontend build: passed.

## Notes

- Existing unrelated and parallel worktree changes were preserved.
- No protected data, upload, environment, dependency, or generated build-output paths were intentionally touched.

## Next Recommended Task

Review the remaining raw `git status --short` display path in `scripts/review-gate.ps1` and decide whether it should stay as a simple capture-only command or receive a small dedicated capture helper.
