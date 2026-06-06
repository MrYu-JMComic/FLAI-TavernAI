# Advanced Settings Stale Helper Cleanup

## Summary

- Removed unused backend advanced-settings helpers `splitAdvancedSettings` and `createDefaultStatusBarBlueprint`.
- Verified both helpers had no remaining backend/frontend source references before removal.
- Left the frontend-local `createDefaultStatusBarBlueprint` form helper untouched because it is unrelated local UI state.

## Changed Files

- `backend/src/modules/advancedSettings.js`
- `automation/reports/2026-06-06-advanced-settings-stale-helper-cleanup.md`

## Validation

- Passed: `rg -n "splitAdvancedSettings" backend\src frontend\src -g "!node_modules" -g "!dist" -g "!automation/reports/**"` returned no matches after removal.
- Passed: `rg -n "createDefaultStatusBarBlueprint" backend\src -g "!node_modules" -g "!dist" -g "!automation/reports/**"` returned no backend matches after removal.
- Passed: `node --test src\tests\backend.test.js src\tests\accessoryAgents.test.js` from `backend` (222 tests).
- Passed: `npm.cmd test` from `backend` (328 tests).
- Passed: `npm.cmd run build` from `frontend`.
- Passed: `git diff --check` (CRLF normalization warnings only).
- Passed: `node scripts\check-encoding.mjs`.
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.

## Safety Notes

- Existing unrelated worktree changes were preserved.
- The pre-existing deleted `automation/reports/*` entries and untracked `automation/reports/archive/` cleanup were left untouched.
- No data, uploads, env files, dependency folders, generated build output, pushes, commits, or resets were touched.

## Next Recommended Task

- Continue stale-export cleanup by scanning one backend module at a time and only removing helpers with code-only no-reference evidence.
