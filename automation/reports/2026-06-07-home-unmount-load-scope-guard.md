# Home Unmount Load Scope Guard

Date: 2026-06-07

## Scope

Close stale load-completion gaps in the Home view after the character list and tag-filter load guards.

## Changes

- Added a Home async reset that invalidates pending character and tag loads on unmount.
- Added tag-load request tokens so overlapping retries or unmounts cannot write stale tag filters or tag errors.
- Reused a small helper for character-load freshness checks.
- Kept the change scoped to Home list/tag loading and left import, reaction, and chat actions unchanged.

## Changed Files

- `frontend/src/views/HomeView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-home-unmount-load-scope-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 442 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 442 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (backend tests 441/441, frontend build passed, scanners passed).

## Next Recommended Task

Continue auditing views with async action handlers that can notify after navigation, starting with Home import/chat/reaction flows.
