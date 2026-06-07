# World Book entry mutation stale guard

Date: 2026-06-07

## Scope

Hardened World Book detail entry mutations so old write requests do not refresh, close forms, or emit notices after the user navigates to a different World Book route.

## Changed files

- `frontend/src/views/WorldBookView.vue`
  - Added a World Book mutation generation token that is invalidated on route changes.
  - Closed pending World Book and entry edit forms when the route changes, avoiding stale form data carrying between books.
  - Captured the target book and entry IDs before entry writes.
  - Guarded entry save, delete, toggle, and reorder completions before refreshing the current book or showing success/error notices.
- `automation/backlog.md`
  - Recorded this autonomous iteration in Done.

## Validation

- PASS: `npm.cmd run build` from `frontend`.
  - Encoding precheck passed: scanned 430 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding checks passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 441/441.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report file was added and updated.
  - Encoding check passed: scanned 431 files.

## User change safety

The worktree already had many modified and untracked files. This run only edited `frontend/src/views/WorldBookView.vue`, updated `automation/backlog.md`, and added this report.

## Notes

- `frontend/src/components/EconomyPanel.vue` was inspected first. It currently only has read-side account/history loads, and those already have request-token guards, so no change was made there.

## Next recommended task

Review World Book book-level create/update/delete and AI-draft creation completions for the same stale-route behavior.
