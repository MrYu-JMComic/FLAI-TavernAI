# 2026-06-08 Review Gate Status Capture

## Summary

Routed the review-gate `git status --short` display through a shared captured native command helper so the status display path preserves output while still checking command resolution and exit status.

## Changed Files

- `scripts/review-gate.ps1`
  - Split native command execution into `Invoke-CapturedNativeCommand` and `Invoke-LoggedNativeCommand`.
  - Kept existing logged command behavior for encoding, diagnostics, npm, and diff checks.
  - Routed `git status --short` through the captured helper and reports a gate failure if the status command fails.
- `backend/src/tests/validation-scripts.test.js`
  - Added source-level coverage for the captured helper, the logged-helper delegation, and the Git status capture path.
  - Added a guard against reintroducing raw `git status --short` capture.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test backend\src\tests\validation-scripts.test.js`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 644 passed, 0 failed.
  - Frontend build: passed.

## Notes

- Existing unrelated and parallel worktree changes were preserved.
- No protected data, upload, environment, dependency, or generated build-output paths were intentionally touched.

## Next Recommended Task

Review whether the review-gate top-level project-root `Push-Location` should be wrapped in a single final cleanup path so future script errors cannot skip directory restoration.
