# Test Hygiene Skipped Test Guard

## Scope

- Expanded the backend test hygiene guard to reject committed skipped tests in addition to focused tests.
- Kept the change limited to backend test hygiene so production behavior is unchanged.

## Changed Files

- `backend/src/tests/test-hygiene.test.js`

## Validation

- `node --test src/tests/test-hygiene.test.js` passed: 3 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 376 tests.
  - Frontend build passed.
  - Encoding checks passed.

## Notes

- This prevents future patches from weakening validation by leaving `test.skip`, `it.skip`, or `describe.skip` in backend tests.
- Next useful follow-up: continue reducing repeated manual global mock setup in backend tests once the current patch stack is cleaner.
