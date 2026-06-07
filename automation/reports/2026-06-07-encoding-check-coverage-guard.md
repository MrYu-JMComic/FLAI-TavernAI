# Encoding Check Coverage Guard

## Scope

- Extended `backend/src/tests/validation-scripts.test.js` to assert `scripts/check-encoding.mjs` keeps `automation/reports` in scan scope.
- Added coverage that the encoding checker continues counting scanned files and reporting that count in success output.
- Kept this as a validation guard only; no product code behavior changed.

## Changed Files

- `backend/src/tests/validation-scripts.test.js`

## Validation

- `node --test src/tests/validation-scripts.test.js src/tests/source-hygiene.test.js` passed: 14 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 390 tests.
  - Frontend build passed.
  - Encoding checks passed.
- `node scripts/check-encoding.mjs` passed: scanned 312 files; no common Chinese mojibake markers found.

## Notes

- This protects the recent encoding-check broadening from being silently reverted.
- Next useful follow-up: continue tying guardrails to concrete project invariants rather than adding broad policy tests.
