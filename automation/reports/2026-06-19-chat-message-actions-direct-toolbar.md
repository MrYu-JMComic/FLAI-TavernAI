# Chat Message Actions Direct Toolbar

## Summary

Removed the folded mobile message-action menu so message actions are exposed directly in the toolbar on narrow screens. Copy, edit, delete, world-book source, swipe, and branch controls now stay in the visible action list without requiring the extra "actions" toggle.

## Changed Files

- `frontend/src/components/chat/ChatMessageItem.vue`
  - Removed the `MoreHorizontal` menu toggle, action-menu open state, menu id/label helpers, and menu close watchers.
  - Kept the existing action emits and busy/disabled props for copy, edit, delete, swipe, and branch controls.
- `frontend/src/styles.css`
  - Removed the small-screen rules that hid `.message-action-list` behind `.message-action-menu-toggle`.
  - Removed the unused `.message-actions.is-menu-open` styling.
- `backend/src/tests/frontendChatMessageItem.test.js`
  - Replaced the previous mobile-menu source assertion with coverage that prevents folded-menu classes and state from returning.

## Validation

- PASS: `node --test src/tests/frontendChatMessageItem.test.js` in `backend` (8 tests).
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm run build` in `frontend`.
- PASS before later unrelated auth-view workspace changes appeared: `npm test` in `backend` (960 tests).
- FAIL after unrelated auth-view changes appeared: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - The gate reached backend tests and failed on `src/tests/frontendAuthViews.test.js`.
  - During the same gate run, `frontend/src/views/LoginView.vue`, `frontend/src/views/RegisterView.vue`, and new `frontend/src/views/AuthView.vue` appeared in the dirty worktree and briefly caused the frontend build stage to miss `RegisterView.vue`.
  - Re-running the current frontend build afterwards passed, but `node --test src/tests/frontendAuthViews.test.js` still fails because the tests expect submit logic inside Login/Register while those views now only import `AuthView`.

## Notes

Existing unrelated dirty files were preserved. This iteration only edited the chat message action component, the scoped message-action stylesheet rules, the ChatMessageItem source test, and this report.

## Next Recommended Task

Finish or realign the external auth-view refactor so `frontendAuthViews.test.js` and the full review gate pass again.
