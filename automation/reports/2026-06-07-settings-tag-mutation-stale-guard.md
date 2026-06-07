# Settings Tag Mutation Stale Guard

Date: 2026-06-07

## Scope

Harden Settings extension tag write completions without broad refactors.

## Changes

- Added a tag mutation token so stale add and delete completions stop before mutating the visible tag list or showing notices.
- Made tag loads verify the extensions page is still current before applying results or clearing loading state.
- Invalidated tag loads and mutations when leaving or re-entering the extensions page.
- Invalidated in-flight tag mutations when the tag load limit changes, so older writes do not apply to a newer visible limit.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-settings-tag-mutation-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 435 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 436 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (backend tests 441/441, frontend build passed, scanners passed).

## Next Recommended Task

Review the multiple `watch(isExtensionsPage, ...)` blocks in `SettingsView.vue` for a small consolidation that preserves the same stale-guard behavior while reducing duplicated page-transition bookkeeping.
