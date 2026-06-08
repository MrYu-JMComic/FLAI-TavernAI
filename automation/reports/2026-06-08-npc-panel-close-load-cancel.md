# 2026-06-08 NPC Panel Close Load Cancel

## Summary

Closed NPC panels now invalidate pending list and detail loads before hidden requests can update loading or error state.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
  - Added a close-path load cancellation helper that advances list/detail request tokens and clears load indicators.
- `backend/src/tests/frontendNpcPanel.test.js`
  - Added source coverage for close-triggered NPC list/detail load cancellation and guarded result application.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendNpcPanel.test.js` in `backend` (9 tests passed)
- PASS: `node scripts/check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Review whether `NpcPanel` close should be locked while a mutation action is busy, matching other close-guarded panels.
