# Random Macro Choice Scan

## Summary

- Replaced random macro choice collection with direct pipe-delimited scanning.
- Preserved trimmed non-empty choice semantics and one `Math.random()` selection per macro expansion.
- Added focused coverage proving random macro expansion no longer depends on `split('|')`.

## Changed Files

- `backend/src/services/macros.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-random-macro-choice-scan.md`

## Validation

- PASS: `node --test backend\src\tests\backend.test.js` (252 tests)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (690 backend tests plus frontend build)
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: protected path status check

## Next Recommended Task

- Continue with another production-path cleanup only when the old behavior can be pinned through public tests or an existing source-hygiene pattern.
