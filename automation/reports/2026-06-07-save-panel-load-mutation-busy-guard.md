# 2026-06-07 Save Panel Load Mutation Busy Guard

## Goal

Prevent save-list refreshes from overlapping with create, load, rename, or delete mutations in the save panel.

## Changes

- Added one `savePanelBusy` computed state that covers list loading and save mutations.
- Guarded `loadSaves()` while another load or save mutation is already running.
- Reused `savePanelBusy` for create, load, delete, rename entry guards, create button disabled state, and retry button disabled state.
- Tightened the SaveLoadPanel source diagnostic so UI disabled states and function guards stay aligned.

## Files Touched

- `frontend/src/components/SaveLoadPanel.vue`
- `backend/src/tests/frontendSaveLoadPanel.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendSaveLoadPanel.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed:
  - Encoding check passed.
  - Unreferenced Vue component diagnostic found no unreviewed candidates.
  - Vue accessibility diagnostic found no inaccessible controls.
  - Backend tests passed: 463 tests.
  - Frontend build passed.

## Notes

- This extends the existing save-panel busy guard instead of adding a second competing mutation mechanism.
