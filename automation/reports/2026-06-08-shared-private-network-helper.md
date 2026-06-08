# Shared Private Network Helper

## Summary

- Added `shared/privateNetwork.js` as the single strict local/private provider URL helper.
- Replaced duplicated backend provider and SettingsView local/private host parsers with imports from the shared helper.
- Updated backend and SettingsView source tests so they verify the shared helper behavior and reject reintroduced local duplicate parsers.

## Changed Files

- `shared/privateNetwork.js`
- `backend/src/services/providers.js`
- `frontend/src/views/SettingsView.vue`
- `backend/src/tests/backend.test.js`
- `backend/src/tests/frontendSettingsView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-shared-private-network-helper.md`

## Validation

- PASS: `node --test --test-name-pattern "custom proxy auth retry only trusts parsed private IPv4 hosts" backend\src\tests\backend.test.js`
- PASS: `node --test --test-name-pattern "SettingsView no-key custom provider readiness" backend\src\tests\frontendSettingsView.test.js`
- PASS: `node scripts/check-encoding.mjs` (scanned 407 files)
- PASS: `git diff --check` (LF/CRLF warnings only)
- PASS: `npm.cmd run build` in `frontend` (Vite transformed 1902 modules)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
  - Encoding check scanned 407 files.
  - Backend tests: 752 pass, 0 fail.
  - Frontend build passed with 1902 modules transformed.

## Next Recommended Task

- Continue looking for duplicated frontend/backend security helpers before doing more allocation-only parser cleanup.
