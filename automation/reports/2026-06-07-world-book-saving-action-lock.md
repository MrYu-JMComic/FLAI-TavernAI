# 2026-06-07 World Book Saving Action Lock

## Goal

Prevent WorldBookView book and entry mutation controls from accepting duplicate actions while another save/delete/toggle/reorder operation is still pending.

## Changes

- Added `saving` entry guards to book create/edit/save/delete, entry create/edit/save/delete/toggle/reorder, AI draft generation, and AI draft creation handlers.
- Set and cleared `saving` around book delete plus entry delete/toggle/reorder mutations using the existing route/mutation token checks.
- Disabled and marked busy the world book and entry action buttons while `saving` is active.
- Kept non-mutating navigation and retry actions available.
- Added focused source coverage for the WorldBookView saving lock.

## Files Touched

- `frontend/src/views/WorldBookView.vue`
- `backend/src/tests/frontendWorldBookView.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendWorldBookView.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` passed with no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 486 backend tests and frontend build.

## Notes

- This keeps the existing stale route/mutation token model and only aligns the visible controls with that busy state.
