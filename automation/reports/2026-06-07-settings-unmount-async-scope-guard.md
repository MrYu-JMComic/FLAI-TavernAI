# Settings Unmount Async Scope Guard

Date: 2026-06-07

## Scope

Close a stale-completion gap left after the Settings personal and extensions async guard patches.

## Changes

- Replaced the personal-only Settings unmount cleanup with a unified async scope reset.
- Reused the same unified reset for Settings/Extensions route transitions.
- Added an extension async reset helper covering tags, presets, mods, mod character options, and regex rules.
- Prevented extension-page mutations or loads from completing with notifications or state writes after the Settings view is destroyed.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-settings-unmount-async-scope-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 439 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 439 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (backend tests 441/441, frontend build passed, scanners passed).

## Next Recommended Task

Continue auditing large Vue views for lifecycle cleanup gaps where stale guards rely only on route-derived computed values.
