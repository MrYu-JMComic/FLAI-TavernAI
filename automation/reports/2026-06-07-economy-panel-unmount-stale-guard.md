# Economy Panel Unmount Stale Guard

Date: 2026-06-07

## Scope

Close an unmount stale-completion gap in the economy side panel.

## Changes

- Added an economy panel disposed flag that flips during component unmount.
- Invalidated pending balance and history load tokens from the unmount cleanup path.
- Guarded balance and history load completions, error notifications, and loading cleanup against destroyed panel instances.

## Changed Files

- `frontend/src/components/EconomyPanel.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-economy-panel-unmount-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 450 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 450 files before final report update).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).

## Next Recommended Task

Continue auditing panel components that keep async requests alive while the parent chat view is being torn down.
