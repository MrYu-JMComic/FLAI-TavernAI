# Review Gate Command Helper

## Summary

- Replaced duplicated native-command capture blocks in `scripts/review-gate.ps1` with `Invoke-LoggedNativeCommand`.
- Routed backend `npm test`, frontend `npm run build`, and Git diff checks through the shared helper while preserving command output, exit-code checks, working-directory handling, and `$ErrorActionPreference` restoration.
- Updated validation-script coverage so the review gate keeps using the shared helper for npm and Git checks.

## Changed Files

- `scripts/review-gate.ps1`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-review-gate-command-helper.md`

## Validation

- `node --test backend\src\tests\validation-scripts.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` passed.
- `git diff --cached --check` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed; backend tests reported 642 pass / 0 fail and the frontend build completed successfully.

## Next Recommended Task

- Continue reducing duplicated validation-script control flow where it has clear behavioral coverage and low risk of conflicting with frontend work.
