# 2026-06-11 Swipe Candidate Control

## Changed
- Clarified the assistant message candidate/switch controls in `frontend/src/components/chat/ChatMessageItem.vue`.
- Changed the counter from a bare `1/2` to `候选 1/2`.
- Stopped showing the right arrow as a hidden "generate new candidate" action; it now only switches to an existing next candidate and disables at the end.
- Added a compact `swipe-counter` pill style in `frontend/src/styles.css`.
- Added `canSwipeNext()` in `frontend/src/views/ChatView.vue` so the right arrow reflects real available candidates.

## Validation
- Browser automation on the real Vite app:
  - Injected a two-candidate swipe state into a live assistant message.
  - Confirmed the control displayed `候选 1/2`.
  - Triggered the next-candidate click path.
  - Confirmed the control changed to `候选 2/2`, previous became enabled, next became disabled, and no new candidate generation was triggered.
- `node --test src/tests/frontendChatMessageItem.test.js`
- `node scripts/check-encoding.mjs`
- `npm run build` in `frontend`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
