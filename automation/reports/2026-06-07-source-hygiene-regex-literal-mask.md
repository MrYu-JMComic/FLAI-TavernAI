# Source Hygiene Regex Literal Mask

## Scope

- Added practical regex literal masking to `backend/src/tests/source-hygiene.test.js`.
- Avoided false positives when regex patterns contain debug-residue text such as `console.log` or `debugger;`.
- Preserved detection for real frontend `console.log(...)` calls and real `debugger;` statements.

## Changed Files

- `backend/src/tests/source-hygiene.test.js`

## Validation

- `node --test src/tests/source-hygiene.test.js` passed: 5 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 381 tests.
  - Frontend build passed.
  - Encoding checks passed.
- `node scripts/check-encoding.mjs` passed: no common Chinese mojibake markers found.

## Notes

- This closes a false-positive gap in the source hygiene scanner without loosening the actual debug-residue checks.
- Next useful follow-up: move on from matcher micro-tuning unless a new concrete false positive or false negative appears.
