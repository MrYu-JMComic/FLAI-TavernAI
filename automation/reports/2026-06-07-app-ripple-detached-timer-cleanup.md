# App Ripple Detached Timer Cleanup

Date: 2026-06-07

## Scope

Tighten the global click-ripple timer path so route changes or conditional UI removal do not leave stale timers holding detached DOM nodes or mutating old elements.

## Changes

- Added a connected-target guard for ripple targets in `App.vue`.
- Pruned stale ripple timers before starting a new ripple interaction.
- Reused a shared `clearRippleTimer()` helper for per-target timer cleanup.
- Guarded the ripple timeout callback so it only removes the active attribute while the target is still mounted.

## Changed Files

- `frontend/src/App.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-app-ripple-detached-timer-cleanup.md`

## Validation

- PASS: `node scripts/check-encoding.mjs` before report creation.
  - Scanned 458 files.
- PASS: `npm.cmd run build` in `frontend`.
  - Prebuild encoding check scanned 458 files.
  - Vite production build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 460 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only edited the App ripple timer cleanup path, updated the backlog Done list, and added this report.

## Next Recommended Task

Continue auditing global notification and navigation state, especially async notification producers that can fire after their originating view has been replaced.
