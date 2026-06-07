# 2026-06-07 Status Bar Unused Text Pattern Helper Cleanup

## Goal

Remove a stale duplicate helper from the status bar module after verifying current extraction uses the safer matcher.

## Changes

- Removed the unused `textValuePatterns` helper from `backend/src/modules/statusBars.js`.
- Verified no repository references to `textValuePatterns` remain.
- Kept the active `textValuePatternsSafe` path unchanged.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/modules/statusBars.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-statusbar-unused-text-pattern-helper-cleanup.md`

## Validation

- Passed: `node --test backend\src\tests\backend.test.js backend\src\tests\frontendStatusBarTemplateSecurity.test.js` (245 tests)
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (534 backend/source tests and frontend build)

## Notes

- Product behavior is unchanged; this only removes a stale unused private helper.
- Existing parallel ChatComposer, HomeView, style, backlog, and report worktree changes were preserved.
