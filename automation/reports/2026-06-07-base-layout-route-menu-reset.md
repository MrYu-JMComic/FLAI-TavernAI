# Base Layout Route Menu Reset

Date: 2026-06-07

## Scope

Keep outer navigation UI in sync when the active route changes through child views, toast actions, browser hash changes, or other non-menu navigation paths.

## Changes

- Updated `BaseLayout.vue` to watch `currentRoute`.
- Closed the user menu and mobile navigation menu whenever the route name changes.
- Preserved existing explicit close behavior for menu clicks, settings navigation, and logout.

## Changed Files

- `frontend/src/components/BaseLayout.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-base-layout-route-menu-reset.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed; scanned 464 files.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 466 files.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only touched the BaseLayout route-menu state, the autonomous backlog, and this report.

## Next Recommended Task

Continue auditing persistent layout and panel state that can survive route changes, especially state owned by components that do not remount between top-level views.
