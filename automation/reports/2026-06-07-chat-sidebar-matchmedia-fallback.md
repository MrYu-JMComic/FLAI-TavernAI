# 2026-06-07 Chat Sidebar MatchMedia Fallback

## Goal

Keep Chat sidebar initial open state reliable in runtimes where `window.matchMedia` is unavailable.

## Changes

- Replaced the direct `window.matchMedia` call for the initial Chat sidebar state with the shared viewport matcher.
- Preserved the existing desktop breakpoint behavior when `matchMedia` is available.
- Added an `innerWidth >= 981` fallback for WebView/test runtimes without `matchMedia`.
- Added regression coverage for desktop and narrow widths without `matchMedia`.
- Added shared viewport coverage for `min-width` fallback queries.

## Files Touched

- `frontend/src/composables/chat/useChatConversation.js`
- `frontend/src/composables/useViewport.js`
- `backend/src/tests/frontendChatConversation.test.js`
- `backend/src/tests/frontendViewport.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatConversation.test.js`: PASS; 9 tests passed.
- `node --test backend\src\tests\frontendViewport.test.js`: PASS; 3 tests passed.

## Notes

- Existing prepare-commit validation changes were preserved.
