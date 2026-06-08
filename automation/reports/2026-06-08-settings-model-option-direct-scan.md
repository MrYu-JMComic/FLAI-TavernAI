# 2026-06-08 Settings Model Option Direct Scan

## Goal

Keep refreshed provider model containment checks cheap and source-tested in SettingsView.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `backend/src/tests/frontendSettingsView.test.js`
- `automation/backlog.md`

## Changes

- Routed refreshed-model containment through `hasProviderModelOption`.
- Replaced the inline `nextOptions.some(...)` callback in the model refresh path.
- Added source-test coverage for the helper and template-facing refresh behavior.

## Validation

- PASS: `node --test backend\src\tests\frontendSettingsView.test.js` (11 tests passed)
- PASS: `npm.cmd test` in `backend` (824 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next

- Continue only with request-hot list scans where helper extraction improves clarity or preserves reactive references.
