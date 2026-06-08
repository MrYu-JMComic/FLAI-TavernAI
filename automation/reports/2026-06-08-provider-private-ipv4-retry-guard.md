# Provider Private IPv4 Retry Guard

## Summary

- Replaced the custom provider local/private host check's broad `127.` prefix handling with strict IPv4 parsing.
- Removed the `host.split('.').map(Number)` path so domain-like hosts cannot be treated as private by loose number coercion or prefix checks.
- Added a focused backend test that keeps private IPv4 retry behavior working while ensuring `127.*` domain names do not retry without Authorization.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-private-ipv4-retry-guard.md`

## Validation

- `node --test --test-name-pattern "custom proxy auth retry only trusts parsed private IPv4 hosts" backend\src\tests\backend.test.js` - pass, 1 test.
- `node scripts/check-encoding.mjs` - pass, scanned 402 files.
- `git diff --check` - pass; Git reported LF/CRLF working-copy warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS; backend tests 749/749 passed and frontend build passed.

## Next Recommended Task

- Audit the mirrored frontend local/private URL helper in `SettingsView.vue` so UI readiness hints stay aligned with backend retry security.
