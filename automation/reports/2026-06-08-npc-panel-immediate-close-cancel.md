# 2026-06-08 NPC Panel Immediate Close Cancel

## Summary

NPC panel close actions now invalidate pending list and detail loads locally before emitting close events.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
  - Calls `cancelNpcPanelLoad()` from `requestClose()` after the existing mutation-busy close guard.
- `backend/src/tests/frontendNpcPanel.test.js`
  - Updated source coverage to require immediate close-path list/detail load cancellation.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendNpcPanel.test.js` in `backend` (10 tests passed)
- PASS: `node scripts/check-encoding.mjs` (scanned 529 files)
- PASS: `git diff --check`
- PASS: `npm.cmd test` in `backend` (830 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Continue auditing high-traffic chat view async handlers for route/context changes that can leave stale UI state visible.
