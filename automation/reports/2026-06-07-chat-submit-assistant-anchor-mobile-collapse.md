# Chat Submit Assistant Anchor And Mobile Status Collapse

## Summary

- Changed expanded-status-bar submit anchoring from the sent user message to the new assistant reply.
- Kept assistant-reply anchoring active while streaming content grows, so the expanded status bar does not pull the viewport below the reply.
- Added a `collapseRequest` input to `StatusBar` so ChatView can request a one-way collapse without toggling it open.
- On phone viewports, sending while the status bar is expanded now auto-collapses the status bar before assistant-reply anchoring.

## Changed Files

- `frontend/src/components/StatusBar.vue`
- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatComposer.test.js`
- `backend/src/tests/frontendChatSubmit.test.js`

## Validation

- PASS: `node --test backend\src\tests\frontendChatSubmit.test.js backend\src\tests\frontendChatScroll.test.js backend\src\tests\frontendChatComposer.test.js`
- PASS: `npm run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Manually verify on a phone-width viewport that an expanded status bar collapses on send and the viewport lands on the new assistant reply.
