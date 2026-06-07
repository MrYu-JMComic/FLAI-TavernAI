# 2026-06-07 Chat Message Swipe Loading Lock

## Goal

Prevent chat message swipe navigation from changing the visible candidate while a new swipe candidate is still being generated.

## Changes

- Added a `swipeLoading` guard to `swipeMessagePrev`, matching the existing duplicate guard in `swipeMessageNext`.
- Disabled the previous-swipe button while `swipeLoading` is true.
- Added `aria-busy` to both previous and next swipe buttons while a swipe request is pending.
- Extended the ChatMessageItem SFC source coverage to assert both the UI lock and the composable guard.

## Files Touched

- `frontend/src/components/chat/ChatMessageItem.vue`
- `frontend/src/composables/chat/useChatMessageActions.js`
- `backend/src/tests/frontendChatMessageItem.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatMessageItem.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 475 backend tests and the frontend build.

## Notes

- The worktree already had other dirty changes in `ChatMessageItem.vue` and `useChatMessageActions.js`; this iteration preserved them and only added the swipe-loading lock.
