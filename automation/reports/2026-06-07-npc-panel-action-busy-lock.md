# 2026-06-07 NPC Panel Action Busy Lock

## Goal

Make NPC panel mutation state visible and prevent duplicate memory, behavior, and NPC removal actions without blocking the internal refreshes that reconcile the panel after a mutation.

## Changes

- Added a shared `npcActionBusyId` guard for NPC panel mutations and reset it with the existing panel state cleanup.
- Wrapped memory create/delete, behavior create/toggle/delete, selected-NPC removal, and empty-NPC cleanup with one action-busy lock and `finally` cleanup.
- Added an `allowWhileBusy` path for mutation completion refreshes while ordinary list/detail refreshes stay guarded during a busy action.
- Disabled mutation controls, form controls, list selection, refresh/retry buttons, and add/cancel buttons while a panel action is busy; action-specific buttons now expose `aria-busy`.
- Added focused SFC source coverage for the busy guard helpers, `finally` cleanup calls, disabled bindings, `aria-busy` bindings, and disabled hover styles.

## Files Touched

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/frontendNpcPanel.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-npc-panel-action-busy-lock.md`

## Validation

- `node --test backend\src\tests\frontendNpcPanel.test.js` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed:
  - Encoding check passed, scanning 530 files.
  - Unreferenced Vue component diagnostic found no unreviewed candidates.
  - Vue accessibility diagnostic found no inaccessible controls.
  - Backend tests passed: 464 tests.
  - Frontend build passed.
- `node scripts\check-encoding.mjs` passed, scanning 530 files.

## Notes

- Mutation completion passes `allowWhileBusy: true`, so NPC counts and detail rows refresh after a save/delete while user-triggered refresh/retry clicks stay disabled.
- Existing unrelated worktree changes were left untouched.
