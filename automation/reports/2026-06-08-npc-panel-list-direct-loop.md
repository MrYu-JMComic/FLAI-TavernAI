# 2026-06-08 NpcPanel List Direct Loop

## Goal

Keep NpcPanel's reference-preserving refresh checks consistent with the rest of the UI without changing NPC behavior or adding new abstraction.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/frontendNpcPanel.test.js`
- `automation/backlog.md`

## Changes

- Replaced `sameListItems(...).every(...)` in `NpcPanel.vue` with a direct index loop that exits on the first mismatch.
- Added source-test coverage for the direct-loop helper shape and a guard against restoring the `currentItems.every(...)` callback path.
- Recorded the iteration in the autonomous backlog.

## Validation

- PASS: `node --test backend\src\tests\frontendNpcPanel.test.js` (8 tests)
- PASS: `node scripts/check-encoding.mjs` (488 files)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (802 backend tests and frontend build)

## Next

- Continue looking for small, source-test-backed cleanup in hot refresh paths before considering broader refactors.
