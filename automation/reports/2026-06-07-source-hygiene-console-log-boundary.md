# Source Hygiene Console Log Boundary

## Scope

- Tightened the frontend `console.log(...)` guard to require the global `console` identifier boundary.
- Allowed optional whitespace around the member access so `console . log(...)` is also detected.
- Added samples proving `myconsole.log(...)` is not reported while spaced global console calls are reported.

## Changed Files

- `backend/src/tests/source-hygiene.test.js`

## Validation

- `node --test src/tests/source-hygiene.test.js` passed: 4 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 380 tests.
  - Frontend build passed.
  - Encoding checks passed.

## Notes

- This reduces false positives around non-global identifiers and closes a small false-negative gap for spaced `console . log(...)` calls.
- Next useful follow-up: keep source hygiene matchers centered on executable debug residue rather than text-like matches.
