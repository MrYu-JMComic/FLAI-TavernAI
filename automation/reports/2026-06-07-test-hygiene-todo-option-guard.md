# Test Hygiene Todo Option Guard

## Scope

- Expanded the backend test hygiene guard to reject `test.todo`, `it.todo`, and `describe.todo`.
- Added coverage for explicit Node test disable options such as `only: true`, `skip: true`, `skip: 'reason'`, and `todo: true`.
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

- A source scan found no current focused, skipped, or todo tests before the guard was expanded.
- Next useful follow-up: consider moving repeated test hygiene scanning helpers into a small shared helper if more source-level guard tests are added.
