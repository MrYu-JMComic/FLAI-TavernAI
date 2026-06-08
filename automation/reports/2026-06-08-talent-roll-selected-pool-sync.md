# TalentRollDialog Selected Pool Refresh Sync

Date: 2026-06-08

## Summary

- Moved selected talent-pool validation into `setPoolsIfChanged` so unchanged and changed refresh results both prune stale `selectedPoolId` values or select the first available pool.
- Reused one `getCurrentPoolById` helper for the selected-pool computed value and roll guards.
- Replaced pool/talent `.some()` and list `.every()` callbacks with direct loops.
- Prepended newly rolled talents with a direct-loop helper instead of cloning the current talent list with spread syntax.

## Changed Files

- `frontend/src/components/TalentRollDialog.vue`
- `backend/src/tests/frontendTalentRollDialog.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-talent-roll-selected-pool-sync.md`

## Validation

- `node --test backend\src\tests\frontendTalentRollDialog.test.js` - pass, 5 tests.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` - PASS, including encoding scan of 407 files, backend test suite with 752 passing tests, and frontend production build.
- `git diff --check` - pass with CRLF warnings only.

## Notes

- Existing unrelated dirty files were preserved.
- Recommended next task: continue scanning selector-style components where selected ids can become stale after a refreshed options list.
