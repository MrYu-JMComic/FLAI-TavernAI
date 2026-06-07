# Base Layout Mobile Nav Viewport Reset

Date: 2026-06-07

## Scope

Prevent the top navigation's mobile-open state from lingering after the viewport is resized back to the desktop layout.

## Changes

- Updated `BaseLayout.vue` to reuse the shared `useViewport()` composable.
- Matched the viewport watcher to the existing mobile topbar CSS breakpoint, `(max-width: 620px)`.
- Closed `mobileNavOpen` when the layout leaves the mobile breakpoint so returning to mobile later does not reopen stale navigation.

## Changed Files

- `frontend/src/components/BaseLayout.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-base-layout-mobile-nav-viewport-reset.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed; scanned 468 files.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 469 files.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only touched BaseLayout responsive navigation state, the autonomous backlog, and this report.

## Next Recommended Task

Continue auditing persistent layout state and viewport-derived UI state for stale values after breakpoint, route, or user/session changes.
