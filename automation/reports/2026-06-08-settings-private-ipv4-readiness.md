# Settings Private IPv4 Readiness

## Summary

- Aligned `SettingsView` custom no-key provider readiness with the backend private-host retry guard.
- Replaced broad `127.` prefix handling and `host.split('.').map(Number)` with strict IPv4 parsing.
- Added a focused frontend source test that executes the helper and proves private IPv4 hosts are trusted while `127.*` domain names are not.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `backend/src/tests/frontendSettingsView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-settings-private-ipv4-readiness.md`

## Validation

- `node --test --test-name-pattern "SettingsView no-key custom provider readiness" backend\src\tests\frontendSettingsView.test.js` - pass, 1 test.
- `node scripts/check-encoding.mjs` - pass, scanned 403 files.
- `git diff --check` - pass; Git reported LF/CRLF working-copy warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS after rerun; backend tests 751/751 passed and frontend build passed.

## Next Recommended Task

- Check the remaining frontend/backend duplicated URL helpers for behavior drift before making more provider parser micro-optimizations.
