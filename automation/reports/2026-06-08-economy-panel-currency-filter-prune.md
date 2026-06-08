# EconomyPanel Currency Filter Prune

## Summary

- Reviewed `EconomyPanel` history filtering for stale UI state after account refreshes.
- Cleared `historyCurrencyFilter` when the selected currency no longer exists in the refreshed account list, so follow-up history loads do not keep querying an invisible stale filter.
- Built currency filter options with a direct loop instead of a spread-plus-`map()` allocation.
- Replaced the shared list equality helper's `.every()` callback with a direct loop to keep refresh comparisons allocation-light.

## Changed Files

- `frontend/src/components/EconomyPanel.vue`
- `backend/src/tests/frontendEconomyPanel.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-economy-panel-currency-filter-prune.md`

## Validation

- PASS: `node --test backend\src\tests\frontendEconomyPanel.test.js`
  - Result: 3 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 399 files; no common Chinese mojibake markers found.
- PASS: `npm.cmd run build` in `frontend`
  - Result: Vite production build completed.
- PASS: `npm.cmd test` in `backend`
  - Result: 746 tests passed.
- PASS: `git diff --check`
  - Result: no whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 746 tests, frontend build passed, review gate passed.

## Existing Worktree Notes

- Preserved existing unrelated changes in provider parsing, frontend API tests, CharacterForm/world-book dialog work, NpcPanel and WorldBookView iterations, and earlier automation reports.

## Next Recommended Task

- Continue auditing panel filters and pagination state for stale selections after refreshed resource lists change underneath the user.
