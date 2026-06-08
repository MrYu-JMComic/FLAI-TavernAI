# Provider SSE Separator Line Scan

## Summary

- Replaced backend provider SSE block delimiter detection with a direct scanner instead of repeated regex `match()` calls.
- Replaced backend provider SSE line parsing with a direct scanner instead of splitting each block into an array and joining data lines.
- Added `streamCompletion` coverage for a CRLF block separator split across stream chunks and source-contract checks for the parser helpers.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-sse-separator-line-scan.md`

## Validation

- PASS: `node --test --test-name-pattern "streamCompletion scans split CRLF" backend\src\tests\backend.test.js`
  - Result: 1 test passed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 393 files; no common Chinese mojibake markers found.
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 742 tests, frontend build passed, review gate passed.

## Next Recommended Task

- Keep backend and frontend stream parsers aligned only where shared behavior can be covered by focused tests.
