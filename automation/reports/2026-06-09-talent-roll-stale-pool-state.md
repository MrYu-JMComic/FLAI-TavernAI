# 2026-06-09 - Talent Roll Stale Pool State

## Changed Files

- `frontend/src/components/TalentRollDialog.vue`
- `backend/src/tests/frontendTalentRollDialog.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-talent-roll-stale-pool-state.md`

## Summary

- Split the post-animation roll freshness check so a still-current dialog with a stale or unavailable pool clears `rolling` before returning.
- Updated TalentRollDialog source coverage to lock the cleanup path and prevent the roll button from staying busy after a stale target.

## Validation

- PASS: `node --test src/tests/frontendTalentRollDialog.test.js` in `backend` (5 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 548 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (843 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

- Continue auditing delayed UI actions for early returns that skip local busy-state cleanup.
