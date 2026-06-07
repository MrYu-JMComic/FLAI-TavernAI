# Source Debug Residue Guard

## Scope

- Added a source hygiene test that rejects committed `debugger` statements in backend and frontend source files.
- Added a frontend source guard that rejects committed `console.log(...)` debug output.
- Kept backend runtime logging untouched so normal server and backup logs remain allowed.

## Changed Files

- `backend/src/tests/source-hygiene.test.js`

## Validation

- `node --test src/tests/source-hygiene.test.js` passed: 2 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 378 tests.
  - Frontend build passed.
  - Encoding checks passed.

## Notes

- A pre-change scan found no current `debugger` statements in `backend/src` or `frontend/src`.
- A pre-change scan found no current `console.log(...)` calls in `frontend/src`.
- Next useful follow-up: continue replacing repeated ad hoc source scans with small hygiene tests where they protect review quality without blocking legitimate runtime logs.
