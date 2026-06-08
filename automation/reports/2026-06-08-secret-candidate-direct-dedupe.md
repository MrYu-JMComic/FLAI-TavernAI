# Secret Candidate Direct Dedupe

## Summary

- Replaced secret decryption candidate `filter`/spread dedupe with direct append-and-seen tracking.
- Preserved candidate order for current app secret, saved local secret, and legacy development secret fallback.
- Added focused coverage proving legacy fallback decryption no longer depends on array `filter`.

## Changed Files

- `backend/src/security.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-secret-candidate-direct-dedupe.md`

## Validation

- PASS: `node --test backend\src\tests\backend.test.js` (253 tests)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (692 backend tests plus frontend build)
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: protected path status check

## Next Recommended Task

- Continue with another security or provider-path cleanup only when fallback behavior and compatibility can be covered directly.
