# Review Gate Diff Helper Refactor

## Summary

- Refactored duplicated `git diff --check` capture logic in `scripts/review-gate.ps1` into `Invoke-GitDiffCheck`.
- Kept stderr conversion, `$LASTEXITCODE` preservation, and `$ErrorActionPreference` restoration in one helper so future diff-check additions do not duplicate fragile PowerShell handling.
- Realigned the ChatMessageItem swipe-lock source test with the current message-list guard contract after the full gate exposed a stale assertion.

## Changed Files

- `scripts/review-gate.ps1`
- `backend/src/tests/validation-scripts.test.js`
- `backend/src/tests/frontendChatMessageItem.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-review-gate-diff-helper-refactor.md`

## Validation

- `node --test backend\src\tests\frontendChatMessageItem.test.js` passed.
- `node --test backend\src\tests\frontendChatMessageActions.test.js` passed.
- `node --test backend\src\tests\validation-scripts.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` passed.
- `git diff --cached --check` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed; backend tests reported 640 pass / 0 fail and the frontend build completed successfully.

## Next Recommended Task

- Continue burning down small source-test drift and local duplication exposed by the review gate before taking on broader frontend refactors.
