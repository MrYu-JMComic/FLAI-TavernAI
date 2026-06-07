# 2026-06-07 Settings Extension Retry Loading Guards

## Goal

Prevent Settings extension retry buttons from bypassing their visible loading locks through direct handler calls.

## Changes

- Added loading-state entry guards to extension retry loaders for tags, presets, mods, mod character options, and regex rules.
- Extended focused SettingsView SFC diagnostics to keep extension retry button disabled states aligned with their handler guards.

## Files Touched

- `frontend/src/views/SettingsView.vue`
- `backend/src/tests/frontendSettingsView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-settings-extension-retry-loading-guards.md`

## Validation

- `node --test backend\src\tests\frontendSettingsView.test.js` passed: 2 tests.
- `node scripts\check-encoding.mjs` passed: scanned 568 files; no common Chinese mojibake markers found.
- `git diff --check` reported only LF-to-CRLF conversion warnings; no whitespace errors were reported.
- `git diff --cached --check` completed without output.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed: encoding check, unreferenced Vue component diagnostic, Vue accessibility diagnostic, backend tests (488 passed), and frontend build all passed.

## Notes

- Internal mutation reload flows already reset the relevant async scope before calling these loaders, so the new guards only block duplicate loading events.
- Existing staged and unstaged worktree changes were preserved.
