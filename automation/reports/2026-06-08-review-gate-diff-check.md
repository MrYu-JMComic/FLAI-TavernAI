# Review Gate Diff Check

## Summary

- Added `git diff --check` and `git diff --cached --check` to the official review gate so whitespace errors and conflict markers in working-tree or staged changes fail before merge.
- Captured Git diff-check stderr as plain text while preserving exit codes so normal Git warnings do not abort the PowerShell gate or print noisy error records.
- Added validation-script coverage to keep both diff checks and their failure labels wired into `scripts/review-gate.ps1`.

## Changed Files

- `scripts/review-gate.ps1`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-review-gate-diff-check.md`

## Validation

- `node --test backend\src\tests\validation-scripts.test.js` passed.
- `git diff --check` passed.
- `git diff --cached --check` passed.
- `node scripts\check-encoding.mjs` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed; backend tests reported 638 pass / 0 fail and the frontend build completed successfully.

## Next Recommended Task

- Continue tightening the review gate around cheap deterministic checks that prevent broken or noisy changes from reaching the heavier backend/frontend validation stages.
