# Shared SSE Helpers

## Summary

- Added `shared/sse.js` as the single block-separator and line-scanner implementation for SSE parsing.
- Replaced duplicated frontend `api.js` and backend provider SSE scan helpers with imports from the shared module.
- Updated frontend API and backend provider tests so they cover shared helper behavior and reject reintroduced local scanner copies.

## Changed Files

- `shared/sse.js`
- `frontend/src/api.js`
- `backend/src/services/providers.js`
- `backend/src/tests/frontendApi.test.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-shared-sse-helpers.md`

## Validation

- PASS: `node --test --test-name-pattern "frontend assistant SSE parser" backend\src\tests\frontendApi.test.js`
- PASS: `node --test --test-name-pattern "streamCompletion scans split CRLF SSE separators" backend\src\tests\backend.test.js`
- PASS: `node scripts/check-encoding.mjs` (scanned 410 files)
- PASS: `git diff --check` (LF/CRLF warnings only)
- PASS: `npm.cmd run build` in `frontend` (Vite transformed 1903 modules)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
  - Encoding check scanned 410 files.
  - Backend tests: 753 pass, 0 fail.
  - Frontend build passed with 1903 modules transformed.

## Next Recommended Task

- Continue looking for duplicated parser or security helpers that now have separate frontend/backend copies.
