# 2026-06-07 Home Pending Keys Composable

## Goal

Reduce duplicate keyed pending-state code in `HomeView` without changing the chat-open or reaction guard behavior.

## Changes

- Added `usePendingKeys()` as a small shared composable for keyed async guards.
- Reused it for Home character chat-open guards and favorite/like reaction guards.
- Reset Home reaction, chat-open, and import pending state when the Home async scope is invalidated.
- Added focused Node tests for duplicate-key blocking, reset behavior, invalid empty keys, and numeric zero ids.

## Files Touched

- `frontend/src/composables/usePendingKeys.js`
- `frontend/src/views/HomeView.vue`
- `backend/src/tests/frontendPendingKeys.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendPendingKeys.test.js` passed.
- `node --test backend\src\tests\frontendPendingKeys.test.js backend\src\tests\frontendViewport.test.js backend\src\tests\frontendChatConversation.test.js` passed.
- `node --test backend\src\tests\validation-scripts.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF warnings and no whitespace errors.
- `frontend`: `npm.cmd run build` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 455 backend tests and the frontend build.

## Notes

- Existing Chat sidebar, viewport, prepare-commit, and Home import pending worktree changes were preserved.
