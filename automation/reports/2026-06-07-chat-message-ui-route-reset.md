# Chat Message UI Route Reset

Date: 2026-06-07

## Scope

Prevent message-level UI state from leaking across active conversation changes in ChatView.

## Changes

- Added `resetMessageUiState()` to the chat message actions composable.
- The reset invalidates message actions, swipe initialization, and branch work, then clears edit drafts, expanded reasoning, swipe state, branch lists, and busy indicators.
- Wired ChatView's active conversation watcher to reset message UI state alongside the existing settings subpanel cleanup.

## Changed Files

- `frontend/src/composables/chat/useChatMessageActions.js`
- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-message-ui-route-reset.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).
- PASS: `node scripts/check-encoding.mjs` after report update.

## Next Recommended Task

Continue auditing parent-held chat UI flags for provider and route changes, especially quick-model switcher saving/refreshing and conversation sidebar bulk-selection edge cases.
