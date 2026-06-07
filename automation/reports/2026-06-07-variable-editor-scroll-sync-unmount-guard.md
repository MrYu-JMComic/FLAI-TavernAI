# Variable Editor Scroll Sync Unmount Guard

Date: 2026-06-07

## Scope

Tighten the variable editor's mirror scroll synchronization so delayed Vue ticks cannot run after the component has unmounted, and repeated prop changes coalesce into one pending sync.

## Changes

- Added an `onBeforeUnmount` disposed guard to `VariableEditor.vue`.
- Replaced direct watcher `nextTick(syncScroll)` calls with a shared `scheduleSyncScroll()` helper.
- Coalesced repeated model, user-value, and disabled-state changes into a single pending `nextTick` scroll sync.
- Invalidated pending scroll-sync ticks during unmount.
- Guarded `syncScroll()` against destroyed refs.

## Changed Files

- `frontend/src/components/VariableEditor.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-variable-editor-scroll-sync-unmount-guard.md`

## Validation

- PASS: `node scripts/check-encoding.mjs` before report creation.
  - Scanned 452 files.
- PASS: `npm.cmd run build` in `frontend`.
  - Prebuild encoding check scanned 452 files.
  - Vite production build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 453 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only edited the VariableEditor scroll-sync lifecycle path, updated the backlog Done list, and added this report.

## Next Recommended Task

Continue auditing settings import/upload flows for FileReader completions that can outlive the current page or section.
