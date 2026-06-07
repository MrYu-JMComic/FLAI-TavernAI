# 2026-06-07 Character Image Action Busy Lock

## Goal

Finish the CharacterImagePanel busy-state guard so image edit, default, delete, reorder, and upload controls cannot start overlapping mutations.

## Changes

- Preserved the existing image action busy state added in the worktree and completed its usage across image mutations.
- Wrapped edit, default, delete, and reorder mutations with `startImageAction()` / `finishImageAction()`.
- Cleared image action busy state when the panel switches character or unmounts.
- Disabled upload, drag, edit, default, delete, and edit-form controls while an image action is busy.
- Added focused source-level coverage for the shared busy guard and template disabled/busy bindings.

## Files Touched

- `frontend/src/components/CharacterImagePanel.vue`
- `backend/src/tests/frontendCharacterImagePanel.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendCharacterImagePanel.test.js` passed.
- `node --test backend\src\tests\frontendCharacterImagePanel.test.js backend\src\tests\frontendSaveLoadPanel.test.js backend\src\tests\frontendStatusBarTemplateSecurity.test.js backend\src\tests\frontendPendingKeys.test.js backend\src\tests\frontendViewport.test.js backend\src\tests\frontendChatConversation.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `frontend`: `npm.cmd run build` passed.
- `git diff --check` reported only LF/CRLF warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 461 backend tests and the frontend build.

## Notes

- The existing stale-token guards remain in place; this change adds user-action exclusion on top of those guards rather than replacing them.
