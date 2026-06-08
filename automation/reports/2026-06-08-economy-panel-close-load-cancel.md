# 2026-06-08 Economy Panel Close Load Cancel

## Summary

Closed economy panels now invalidate pending account and history loads before hidden requests can update loading or error state.

## Changed Files

- `frontend/src/components/EconomyPanel.vue`
  - Added a close-path load cancellation helper that advances both economy request tokens and clears load indicators.
- `backend/src/tests/frontendEconomyPanel.test.js`
  - Added source coverage for close-triggered account/history load cancellation and guarded result application.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendEconomyPanel.test.js` in `backend` (4 tests passed)
- PASS: `node scripts/check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Review `NpcPanel` close-path cancellation so hidden NPC list or detail refreshes cannot update stale panel state.
