# 2026-06-08 Frontend CSRF Cookie Exact Scan

## Goal

Harden frontend CSRF token reuse from cookies so only the exact `flai_csrf` cookie name is trusted.

## Changed Files

- `frontend/src/api.js`
- `backend/src/tests/frontendApi.test.js`
- `automation/backlog.md`

## Changes

- Replaced the broad `document.cookie.match(...)` CSRF lookup with a direct cookie-pair scanner.
- Preserved percent-decoding and the existing `/api/csrf-token` fallback when no exact cookie exists.
- Added frontend API coverage proving prefix-similar cookie names do not supply the CSRF header.

## Validation

- PASS: `node --test backend\src\tests\frontendApi.test.js` (26 tests passed)
- PASS: `npm.cmd test` in `backend` (825 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next

- Continue improving frontend API error and auth-edge handling where a focused test can reproduce the exact failure mode.
