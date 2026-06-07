# 2026-06-07 Chat Lorebook Appearance Entry Guard

## Goal

Prevent chat lorebook selection changes from bypassing the appearance saving lock through parent-level update events.

## Changes

- Added a guarded `setChatLorebookId()` entry point in `useChatAppearance`.
- Routed `ChatView` lorebook update events through the composable setter instead of directly assigning the ref.
- Added behavior coverage for saving-time lorebook updates and source coverage for the parent wiring.
- Made `useChatAppearance` local imports extension-explicit so Node diagnostics can import it directly.

## Files Touched

- `frontend/src/composables/chat/useChatAppearance.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatAppearance.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatAppearance.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 478 backend tests and the frontend build.

## Notes

- Existing appearance upload and clear entry guards were preserved.
- Existing dirty worktree changes were not reverted or rewritten.
