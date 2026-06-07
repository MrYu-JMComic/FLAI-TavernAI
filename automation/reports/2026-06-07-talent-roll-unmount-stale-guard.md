# Talent Roll Unmount Stale Guard

Date: 2026-06-07

## Scope

Close the remaining unmount stale-completion gap in the talent roll dialog after the character and permission context guard.

## Changes

- Added a dialog disposed flag that flips during component unmount.
- Invalidated the dialog context version on unmount so pending loads, delayed roll animations, delete requests, and clear-all requests stop before state writes or notifications.
- Reused the existing dialog context guard instead of adding another mutation token.

## Changed Files

- `frontend/src/components/TalentRollDialog.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-talent-roll-unmount-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 446 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 447 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).

## Next Recommended Task

Continue auditing delayed frontend callbacks that are guarded against route changes but not component teardown.
