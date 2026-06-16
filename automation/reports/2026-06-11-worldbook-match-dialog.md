# 2026-06-11 World Book Match Dialog

## Changed
- Replaced the bottom `details.chat-worldbook-explain` world-book match panel with a message action button and fixed dialog in `frontend/src/views/ChatView.vue`.
- Added the per-message world-book source button entry to `frontend/src/components/chat/ChatMessageItem.vue`.
- Updated the advanced setting copy to describe the new button/dialog behavior.
- Updated the existing frontend source assertion so the review gate no longer expects the removed bottom details panel.

## Validation
- Browser automation with Edge DevTools on the real Vite app:
  - Injected 3 world-book match rows into the live `ChatView` runtime state.
  - Confirmed one message-level world-book button appears.
  - Clicked the button and confirmed the dialog opens with 3 list items.
  - Confirmed `details.chat-worldbook-explain` is no longer present.
  - Clicked the dialog close button and confirmed the dialog closes.
- `node --test src/tests/frontendChatComposer.test.js`
- `node scripts/check-encoding.mjs`
- `npm run build` in `frontend`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Notes
- The browser check used a temporary headless Edge profile and an existing local session cookie; it did not write chat data or send a model request.
