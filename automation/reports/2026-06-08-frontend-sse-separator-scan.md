# Frontend SSE Separator Scan

## Summary

- Replaced frontend SSE block delimiter detection with a direct scanner instead of repeated regex `match()` calls.
- Preserved LF, CRLF, and split-across-chunk CRLF block separator handling.
- Added frontend API coverage for a `done` event whose `\r\n\r\n` separator arrives across multiple stream chunks.

## Changed Files

- `frontend/src/api.js`
- `backend/src/tests/frontendApi.test.js`
- `automation/reports/2026-06-08-frontend-sse-separator-scan.md`

## Validation

- PASS: `node --test backend\src\tests\frontendApi.test.js`
  - Result: 25 tests passed.
- PASS: `npm.cmd test` in `backend`
  - Result: 740 tests passed.
- PASS: `npm.cmd run build` in `frontend`
  - Result: Vite production build completed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 391 files; no common Chinese mojibake markers found.
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 740 tests, frontend build passed, review gate passed.

## Next Recommended Task

- Continue reviewing stream parsing and retry paths for small allocations or stale-state hazards that can be covered through public API tests.
