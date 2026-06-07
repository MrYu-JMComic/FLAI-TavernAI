# Test Hygiene Mock Assignment Guard

## Scope

- Tightened the backend test hygiene guard so mock assignment checks do not mistake restore statements for new mocks.
- Kept the change limited to test hygiene coverage; no production code changed in this iteration.

## Changed Files

- `backend/src/tests/test-hygiene.test.js`

## Validation

- `node --test src/tests/test-hygiene.test.js` passed: 3 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed: backend tests passed, frontend build passed, encoding check passed.

## Notes

- The guard now distinguishes `globalThis.fetch = originalFetch;` and `Math.random = originalRandom;` restore lines from mock assignments.
- Next useful follow-up: continue consolidating backend test helper patterns so individual tests need fewer manual global mock guards.
