# Economy Warning Capture

## Scope

- Captured the expected insufficient-funds warning in the economy intent-processing test instead of letting it print during normal test runs.
- Asserted the captured warning label and message content so the skip path remains verified.
- Extended the backend test hygiene guard so `console.warn` mocks must be restored before the next test and restored from `finally` blocks.

## Changed Files

- `backend/src/tests/economy.test.js`
- `backend/src/tests/test-hygiene.test.js`

## Validation

- `node --test src/tests/economy.test.js src/tests/test-hygiene.test.js` passed: 61 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 385 tests.
  - Frontend build passed.
  - Encoding checks passed.
- `node scripts/check-encoding.mjs` passed: no common Chinese mojibake markers found.

## Notes

- Focused validation no longer prints the expected `[economy] Transaction intent skipped` warning, reducing test noise without weakening the production warning path.
- Next useful follow-up: inspect another noisy or brittle validation path and turn expected side effects into explicit assertions.
