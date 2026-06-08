# SaveLoadPanel Current Row and Rename Draft Sync

Date: 2026-06-08

## Summary

- Re-read the current save row before load, delete, and rename mutations so stale row events cannot carry old ids or names into UI confirmations and API calls.
- Clear the active rename draft when refreshed save rows no longer contain that save.
- Avoid cloning the save list for the display-only `sortedSaves` computed value and replace save-list equality `.every()` with a direct loop.
- Added source coverage for current-row mutation guards and stale rename-draft cleanup.

## Changed Files

- `frontend/src/components/SaveLoadPanel.vue`
- `backend/src/tests/frontendSaveLoadPanel.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-save-load-current-row-rename-sync.md`

## Validation

- `node --test backend\src\tests\frontendSaveLoadPanel.test.js` - pass, 4 tests.
- `node scripts/check-encoding.mjs` - pass, 403 files scanned.
- `npm.cmd run build` in `frontend` - pass.
- `npm.cmd test` in `backend` - pass, 751 tests.
- `git diff --check` - pass with CRLF warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` - PASS.

## Notes

- The worktree already contained unrelated modified and untracked files from parallel iterations; this run only intentionally changed the files listed above.
- Recommended next task: continue scanning panels with editable row drafts for refresh-time cleanup gaps, especially places where a local draft id can outlive a list refresh.
