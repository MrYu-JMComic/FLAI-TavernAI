# Settings Personal Mutation Stale Guard

Date: 2026-06-07

## Scope

Harden Settings personal-page async completions after the extension-page stale-guard passes.

## Changes

- Added personal-page request tokens for provider settings load/save, model refresh, avatar upload, profile save, and DeepSeek balance queries.
- Guarded stale completions after route switches, component unmounts, overlapping requests, and edited form/profile values.
- Reloaded personal settings when a reused Settings component transitions back from extensions to the personal page.
- Hid stale balance details unless the current provider context can still query DeepSeek balance.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-settings-personal-mutation-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 438 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 438 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (backend tests 441/441, frontend build passed, scanners passed).

## Next Recommended Task

Audit whether repeated Settings stale-guard helpers can be lightly consolidated without changing behavior.
