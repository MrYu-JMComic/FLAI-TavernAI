# 2026-06-07 Production Runbook

## Backlog Item

- Document production startup and backup/restore steps for local SQLite data.

## Changes

- Added `docs/production-runbook.md`.
  - First-time setup and production-like startup commands.
  - Required environment variables and `APP_SECRET` warning.
  - Backend health check.
  - SQLite data, WAL/SHM, upload, backup, and restore procedures.
  - Automatic backup behavior and admin backup endpoints.
  - Operational checks before merging autonomous changes.
- Added the new runbook to `docs/README.md`.
- Linked the runbook from the Data section in `README.md`.
- Moved the backlog item from Ready to Done.

## Validation

- PASS: `node scripts/check-encoding.mjs`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 393/393.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report was written.

## Notes

- The worktree already contained many modified and untracked files from earlier iterations; this run intentionally changed the two README files, backlog, the new runbook, and this report.
- This is documentation only; no application code paths were changed in this run.
