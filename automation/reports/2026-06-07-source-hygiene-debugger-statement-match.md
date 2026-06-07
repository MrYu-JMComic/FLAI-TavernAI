# Source Hygiene Debugger Statement Match

## Scope

- Tightened the source hygiene debugger guard from broad word matching to debugger-statement matching.
- Added sample coverage so object properties and member names containing `debugger` are not reported.
- Kept the guard focused on actual debug residue to avoid false positives in legitimate code.

## Changed Files

- `backend/src/tests/source-hygiene.test.js`

## Validation

- `node --test src/tests/source-hygiene.test.js` passed: 3 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 379 tests.
  - Frontend build passed.
  - Encoding checks passed.

## Notes

- The guard still rejects actual `debugger;` statements after comments and strings are masked.
- Next useful follow-up: consider caching source file reads in `source-hygiene.test.js` if more source hygiene rules are added.
