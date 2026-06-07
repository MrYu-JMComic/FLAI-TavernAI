# Source Hygiene Template Interpolation Scan

## Scope

- Updated source masking so template literal text remains ignored while `${...}` interpolation code is scanned.
- Added focused coverage for frontend `console.log(...)` and `debugger;` inside template interpolation code.
- Preserved the existing protections against false positives in strings and comments.

## Changed Files

- `backend/src/tests/source-hygiene.test.js`

## Validation

- `node --test src/tests/source-hygiene.test.js` passed: 4 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 380 tests.
  - Frontend build passed.
  - Encoding checks passed.

## Notes

- This closes a false-negative gap where real debug residue inside template interpolation could be hidden by the string masker.
- Next useful follow-up: keep future hygiene rules backed by samples that cover both false positives and false negatives.
