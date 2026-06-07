# 2026-06-07 Chat Sidebar Shared Viewport Match

## Goal

Avoid leaving a one-off Chat sidebar viewport helper after adding the
`matchMedia` fallback.

## Change

- Exported `isViewportMatch()` from `frontend/src/composables/useViewport.js`.
- Extended the shared fallback parser to support simple `min-width` queries.
- Updated `useChatConversation()` to use the shared matcher for the desktop
  sidebar breakpoint.
- Added shared viewport coverage for `min-width` fallback behavior.

## Files Touched

- `frontend/src/composables/useViewport.js`
- `frontend/src/composables/chat/useChatConversation.js`
- `backend/src/tests/frontendViewport.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-sidebar-matchmedia-fallback.md`
- `automation/reports/2026-06-07-chat-sidebar-shared-viewport-match.md`

## Validation

- `node --test backend\src\tests\frontendViewport.test.js`: PASS; 3 tests
  passed.
- `node --test backend\src\tests\frontendChatConversation.test.js`: PASS; 9
  tests passed.
- `node scripts/check-encoding.mjs`: PASS; scanned 507 files.
- `npm run build` in `frontend`: PASS; Vite production build completed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS;
  453 backend tests passed and frontend build completed.

## Notes

This removes the local `readDesktopSidebarMatch()` helper instead of adding
another viewport special case to the chat composable.
