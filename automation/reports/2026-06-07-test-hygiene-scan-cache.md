# Test Hygiene Scan Cache

## Scope

- Reused a single loaded snapshot of backend test files across all test hygiene guards.
- Removed repeated directory and file reads from each source-line scan.
- Kept the change limited to backend test hygiene; production behavior is unchanged.

## Changed Files

- `backend/src/tests/test-hygiene.test.js`

## Validation

- `node --test src/tests/test-hygiene.test.js` passed: 3 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 376 tests.
  - Frontend build passed.
  - Encoding checks passed.

## Notes

- The hygiene guard still scans the current test files at module load time, then shares that snapshot across the individual guard tests.
- Next useful follow-up: extract common global mock setup into backend test helpers when the surrounding patch stack is less crowded.
