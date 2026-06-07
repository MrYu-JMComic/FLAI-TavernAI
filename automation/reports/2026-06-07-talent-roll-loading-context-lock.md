# 2026-06-07 Talent Roll Loading Context Lock

## Goal

Prevent TalentRollDialog from letting stale pool or talent data from a previous character drive actions while the new dialog context is still loading.

## Changes

- Included `loading` in the shared `talentActionBusy` state so Roll, clear-all, remove, and pool selection stay disabled until the current character data is loaded.
- Cleared stale pools, talents, and the selected pool when the dialog context changes.
- Reused the existing action-busy guard in `doRoll()` instead of maintaining a separate roll-only condition.
- Tightened focused SFC source coverage for the loading-aware action busy state and context reset.

## Files Touched

- `frontend/src/components/TalentRollDialog.vue`
- `backend/src/tests/frontendTalentRollDialog.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendTalentRollDialog.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 465 backend tests and the frontend build.

## Notes

- This keeps stale-token guards responsible for ignoring obsolete async responses while preventing user actions from starting before the current context is ready.
