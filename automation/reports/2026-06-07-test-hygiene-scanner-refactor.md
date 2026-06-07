# Test Hygiene Scanner Refactor

## Scope

- Refactored the backend test hygiene scanner to share test-file reading and source-line iteration.
- Tightened mock-restore boundary detection so it recognizes `describe`, `it`, and `test` declarations consistently.
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

- This consolidates recent guard patches so future hygiene rules can reuse one scanner path instead of duplicating file traversal.
- Next useful follow-up: extract common global mock setup into explicit backend test helpers once the surrounding patch stack is cleaner.
