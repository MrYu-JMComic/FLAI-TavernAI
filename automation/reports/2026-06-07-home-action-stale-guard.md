# Home Action Stale Guard

Date: 2026-06-07

## Scope

Close stale action-completion gaps in the Home view after the Home load-scope guard.

## Changes

- Added a Home active flag that flips off during unmount and is reused by Home load freshness checks.
- Guarded chat open, reaction save, and character import completions before navigation, notifications, state merges, or loading cleanup.
- Snapshotted the pending import payload before submitting so later dialog state changes cannot alter the in-flight request.
- Guarded the mount-time post-load layout refresh so it does not run after the view is destroyed.

## Changed Files

- `frontend/src/views/HomeView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-home-action-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 444 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 444 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).

## Next Recommended Task

Continue auditing view-level async handlers for unmount guards, prioritizing pages that still mix direct navigation emits with async mutations.
