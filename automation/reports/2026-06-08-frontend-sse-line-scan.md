# Frontend SSE Line Scan

## Summary

- Replaced frontend SSE event block parsing with a direct line scanner instead of splitting each streamed block into an intermediate array.
- Appended multi-line `data:` payload text directly instead of collecting `dataLines` and joining them per event block.
- Preserved CRLF and LF line handling for `event:` and multi-line `data:` fields.
- Added frontend API coverage so CRLF multi-line error payloads still surface as readable user-facing errors and the hot path stays array-free.

## Changed Files

- `frontend/src/api.js`
- `backend/src/tests/frontendApi.test.js`
- `automation/reports/2026-06-08-frontend-sse-line-scan.md`

## Validation

- PASS: `node --test backend\src\tests\frontendApi.test.js`
  - Result: 24 tests passed.
- PASS: `npm.cmd test` in `backend`
  - Result: 740 tests passed.
- PASS: `npm.cmd run build` in `frontend`
  - Result: Vite production build completed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 391 files; no common Chinese mojibake markers found.
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: review gate passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 739 tests, frontend build passed, review gate passed.

## Next Recommended Task

- Continue trimming hot-path stream parsing only where behavior can be protected by public API tests.
