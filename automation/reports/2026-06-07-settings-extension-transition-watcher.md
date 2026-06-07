# Settings Extension Transition Watcher

Date: 2026-06-07

## Scope

Reduce duplicated Settings extension-page transition bookkeeping after the tag, preset, mod, and regex stale-guard patches.

## Changes

- Replaced separate tag, preset, and mod `watch(isExtensionsPage, ...)` blocks with a single `handleExtensionsPageChange()` watcher.
- Kept the same load invalidation behavior for tags, presets, mods, and mod character options.
- Added regex load invalidation and reload on extension-page transitions.
- Tightened `isCurrentRegexLoad()` so regex load completions also require the extensions page to still be active.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-settings-extension-transition-watcher.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 436 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 437 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (backend tests 441/441, frontend build passed, scanners passed).

## Next Recommended Task

Audit Settings-side profile/provider write operations for stale completion behavior after switching between personal and extensions routes.
