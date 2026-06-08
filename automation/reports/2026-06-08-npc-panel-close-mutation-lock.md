# 2026-06-08 NPC Panel Close Mutation Lock

## Summary

NPC panel close actions now stay disabled while an NPC mutation is busy, preventing hidden mutation completions from finishing against a closed panel.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
  - Guarded `requestClose()` behind `npcActionBusy` and exposed disabled/busy close-button state.
  - Limited the close-button hover style to enabled buttons and added disabled styling.
- `backend/src/tests/frontendNpcPanel.test.js`
  - Added source coverage for the close guard, disabled close button state, and disabled hover styling.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendNpcPanel.test.js` in `backend` (10 tests passed)
- PASS: `node scripts/check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Review remaining modal or drawer close paths for mutation-busy guards so hidden async completions cannot update closed UI.
