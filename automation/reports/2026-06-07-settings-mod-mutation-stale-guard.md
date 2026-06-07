# Settings Mod Mutation Stale Guard

Date: 2026-06-07

## Scope

Harden Settings extension Mod write completions without broad refactors.

## Changes

- Added a Mod mutation token so stale save, delete, enable/disable, and reorder completions stop before mutating current UI state or showing notices.
- Invalidated Mod list and character-option loads when leaving or re-entering the extensions page.
- Split Mod editor reset into `resetModForm()`, `closeModEditor()`, and `cancelModEdit()` so user cancellation invalidates in-flight saves while successful completions can still reload and notify only if current.
- Made failed Mod reorder restore the previous list only when the reorder operation is still current.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-settings-mod-mutation-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 434 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 435 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (backend tests 441/441, frontend build passed, scanners passed).

## Next Recommended Task

Audit Settings tag write completions (`addTag` and `removeTag`) for stale page transitions and overlapping tag reloads.
