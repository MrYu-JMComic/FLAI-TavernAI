# Settings Preset Mutation Stale Guard

Date: 2026-06-07

## Scope

Harden Settings extension preset write completions without broad refactors.

## Changes

- Added a preset mutation token so stale save, delete, default, and import completions stop before mutating current UI state or showing notices.
- Invalidated preset load and mutation scopes when the Settings view leaves or re-enters the extensions page.
- Replaced the inline preset editor cancel expression with `cancelPresetEdit()` so user cancellation invalidates in-flight preset saves.
- Removed the dormant `showPresetImport` state and made preset file imports run through the guarded import flow after `FileReader` completes.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-settings-preset-mutation-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 433 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 434 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (backend tests 441/441, frontend build passed, scanners passed).

## Next Recommended Task

Apply the same write-side stale completion audit to Settings Mod mutations (`saveMod`, `removeMod`, `toggleMod`, and reorder).
