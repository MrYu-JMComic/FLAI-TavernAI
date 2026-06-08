# 2026-06-08 Encoding Check Streaming Line Scan

## Summary

Changed the UTF-8 encoding checker to scan decoded file text in one pass while tracking line boundaries, instead of splitting every checked file into a full line array before looking for mojibake markers. The report text is still sliced only for matching lines, and CRLF line-number behavior is covered by the validation fixture.

## Changed Files

- `scripts/check-encoding.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-encoding-check-streaming-line-scan.md`

## Validation

- PASS: `node scripts\check-encoding.mjs` (319 files scanned before this report was added)
- PASS: `node --test backend\src\tests\validation-scripts.test.js` (13 tests)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 656 pass, 0 fail
  - Frontend build: passed

## Notes

- The validation source contract now rejects the old `text.split(/\r?\n/)` line-array path in the encoding checker.
- The mojibake fixture now checks a CRLF second-line hit so line numbers stay stable after the scan refactor.
- Existing parallel frontend, backend, backlog, archive, and report changes were preserved.
- No protected data, upload, environment, dependency, or generated build-output paths were edited.

## Next Recommended Task

Continue reducing diagnostic hot-path intermediate arrays, or shift to a narrow source-hygiene cleanup if the current parallel backend/frontend patches settle.
