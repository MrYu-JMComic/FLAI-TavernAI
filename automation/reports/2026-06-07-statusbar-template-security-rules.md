# 2026-06-07 StatusBar Template Security Rules

## Goal

Reduce drift risk between StatusBar custom-template validation and rendering sanitization without changing supported template behavior.

## Changes

- Added `frontend/src/utils/statusBarTemplateSecurity.js` for shared allowed tag sets, dangerous CSS checks, style sanitizers, and HTML escaping.
- Reused the shared rules from `StatusBar.vue` rendering sanitization.
- Reused the shared validation tag set and dangerous CSS detector from `useChatAccessory.js`.
- Made `useChatAccessory.js` importable by Node diagnostics by adding explicit `.js` extensions for its local imports touched by this refactor.
- Added focused Node coverage for allowlist alignment, unsafe CSS filtering, validation behavior, and HTML escaping fallback.

## Files Touched

- `frontend/src/utils/statusBarTemplateSecurity.js`
- `frontend/src/components/StatusBar.vue`
- `frontend/src/composables/chat/useChatAccessory.js`
- `backend/src/tests/frontendStatusBarTemplateSecurity.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendStatusBarTemplateSecurity.test.js` passed.
- `node --test backend\src\tests\frontendStatusBarTemplateSecurity.test.js backend\src\tests\frontendPendingKeys.test.js backend\src\tests\frontendViewport.test.js backend\src\tests\frontendChatConversation.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF warnings and no whitespace errors.
- `frontend`: `npm.cmd run build` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 459 backend tests and the frontend build.

## Notes

- Existing dirty Chat sidebar, viewport, prepare-commit, and Home pending-state changes were preserved.
