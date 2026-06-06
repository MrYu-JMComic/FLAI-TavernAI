# Conversation Appearance Stale Helper Cleanup

## Summary

- Removed the unused `mergeConversationAppearance` export from `backend/src/modules/conversationAppearance.js`.
- Removed its private `defaultAppearance` factory, which had no remaining backend use after the export was removed.
- Left `backend/src/routes/helpers.js` and `frontend/src/utils/chatAppearance.js` helpers untouched because those are active, separate call sites.

## Changed Files

- `backend/src/modules/conversationAppearance.js`
- `automation/reports/2026-06-06-conversation-appearance-stale-helper-cleanup.md`

## Validation

- Passed: `rg -n "mergeConversationAppearance" backend\src frontend\src -g "!node_modules" -g "!dist" -g "!automation/reports/**"` shows only the active route helper.
- Passed: `rg -n "defaultAppearance" backend\src\modules\conversationAppearance.js backend\src frontend\src -g "!node_modules" -g "!dist" -g "!automation/reports/**"` shows only the active frontend helper.
- Passed: `node --test src\tests\backend.test.js` from `backend` (210 tests).
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

- Continue module-by-module stale export cleanup, prioritizing helpers whose names appear only in their own module and in intentionally separate frontend-local utilities.
