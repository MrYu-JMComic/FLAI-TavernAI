# Encoding Check Direct UTF-8 Read

## Summary

Changed the UTF-8 encoding checker to read scanned files directly as UTF-8 text instead of reading a `Buffer` and converting it with `.toString('utf8')`. This removes one allocation step per scanned file while keeping the same line scan and mojibake detection behavior.

## Changed Files

- `scripts/check-encoding.mjs`
  - Replaced the Buffer read plus `.toString('utf8')` conversion with `readFileSync(filePath, 'utf8')`.
- `backend/src/tests/validation-scripts.test.js`
  - Updated the encoding checker source contract to require direct UTF-8 reads.
  - Added a guard against returning to the Buffer conversion path.
- `automation/backlog.md`
  - Recorded this completed iteration.

## Validation

- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 350 files; no common Chinese mojibake markers found.
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend test suite passed: 681 tests.
  - Frontend build passed.
  - Git status check completed.

## Next Recommended Task

Continue small diagnostic hot-path cleanups only where there is a clear intermediate allocation or source-hygiene blind spot to remove.
