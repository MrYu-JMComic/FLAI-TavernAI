# Settings regex mutation stale guard

Date: 2026-06-07

## Scope

Hardened Settings regex-rule mutations so old toggle, reorder, or import completions do not update notices or reload state after the user switches regex group filters.

## Changed files

- `frontend/src/views/SettingsView.vue`
  - Added a regex mutation generation token that is invalidated when the regex group filter changes.
  - Added a focused current-mutation helper for the active extensions page and regex group filter.
  - Guarded regex rule toggle, drag reorder, and import completions before showing success/error notices or reloading rules.
  - Routed the regex group select through a handler that invalidates in-flight regex mutations before loading the new group.
- `automation/backlog.md`
  - Recorded this autonomous iteration in Done.

## Validation

- PASS: `npm.cmd run build` from `frontend`.
  - Encoding precheck passed: scanned 432 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding checks passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 441/441.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report file was added and updated.
  - Encoding check passed: scanned 433 files.

## User change safety

The worktree already had many modified and untracked files. This run only edited `frontend/src/views/SettingsView.vue`, updated `automation/backlog.md`, and added this report.

## Notes

- Existing Settings regex read-side load guards were preserved. This run only adds write-side stale-completion protection for the same group-filter boundary.

## Next recommended task

Review Settings preset and mod save/delete/default/reorder/import completions for stale section or overlapping reload behavior.
