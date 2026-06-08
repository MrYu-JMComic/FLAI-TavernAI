# 2026-06-08 Economy Panel Immediate Close Cancel

## Summary

Economy panel close actions now invalidate pending account and history loads locally before emitting the close event.

## Changed Files

- `frontend/src/components/EconomyPanel.vue`
  - Added `requestClose()` so backdrop and close-button actions cancel panel loads immediately before emitting `close`.
- `backend/src/tests/frontendEconomyPanel.test.js`
  - Extended close-path coverage to require the local close handler and prevent direct template `emit('close')` calls.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendEconomyPanel.test.js` in `backend` (4 tests passed)
- PASS: `node scripts/check-encoding.mjs` (scanned 527 files)
- PASS: `git diff --check`
- PASS: `npm.cmd test` in `backend` (830 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Apply the same immediate close-cancel pattern to other load-only panels when a local close helper is missing.
