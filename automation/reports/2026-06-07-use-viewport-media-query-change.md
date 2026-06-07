# Use Viewport Media Query Change

Date: 2026-06-07

## Scope

Reduce unnecessary viewport state updates while keeping breakpoint-derived UI state timely.

## Changes

- Updated `frontend/src/composables/useViewport.js` to create one `matchMedia()` query per composable instance.
- Prefer `MediaQueryList` `change` events so `isPhone` updates only when the configured breakpoint match changes.
- Kept the existing `check()` API intact for callers that need an explicit refresh.
- Preserved compatibility with older `addListener` APIs and a resize fallback when media-query change listeners are unavailable.
- Cleaned up whichever listener was registered during component unmount.

## Changed Files

- `frontend/src/composables/useViewport.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-use-viewport-media-query-change.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed; scanned 470 files.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 471 files.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only touched the shared viewport composable, the autonomous backlog, and this report.

## Next Recommended Task

Continue auditing viewport and layout-derived state, especially components that still bind expensive work directly to resize events.
