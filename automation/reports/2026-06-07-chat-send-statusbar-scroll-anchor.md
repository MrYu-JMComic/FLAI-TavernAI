# Chat Send Status Bar Scroll Anchor

## Summary

- Added a message-level scroll target helper for chat message scrollers.
- When the chat is already pinned to the bottom and the inline status bar is expanded, sending now anchors the viewport to the newly sent user message instead of scrolling to the bottom of the expanded status bar.
- Kept the normal bottom-stick behavior for conversations without an expanded status bar.

## Changed Files

- `frontend/src/composables/chat/useChatScroll.js`
- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatSubmit.test.js`
- `backend/src/tests/frontendChatScroll.test.js`

## Validation

- PASS: `node --test backend\src\tests\frontendChatSubmit.test.js backend\src\tests\frontendChatScroll.test.js`
- PASS: `npm run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- FAIL: `npm test` in `backend`
  - `frontendSettingsView.test.js` currently fails against unrelated SettingsView/tag-control expectations in the dirty worktree.
  - `source-hygiene.test.js` currently reports unrelated unused imports in backend route/module files already modified outside this change.
- FAIL: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - The gate reaches the backend test stage and fails on the same unrelated `source-hygiene.test.js` unused import findings.

## Next Recommended Task

- Clean up or reconcile the existing SettingsView/source-hygiene dirty changes, then re-run the full backend test suite.
