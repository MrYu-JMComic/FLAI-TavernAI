# Source Hygiene Scan Cache

## Scope

- Cached masked backend and frontend source files at module load for source hygiene checks.
- Reused cached masked text across debugger and frontend `console.log(...)` guards instead of rereading and remasking source files for each rule.
- Kept source hygiene matching behavior unchanged.

## Changed Files

- `backend/src/tests/source-hygiene.test.js`

## Validation

- `node --test src/tests/source-hygiene.test.js` passed: 3 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 379 tests.
  - Frontend build passed.
  - Encoding checks passed.

## Notes

- The focused test run showed the individual source hygiene scans completing faster after cached masked text was introduced.
- Next useful follow-up: continue keeping hygiene checks narrow and cached as more source-level guardrails are added.
