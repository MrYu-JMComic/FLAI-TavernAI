# Chat Sidebar Search Control

Date: 2026-06-07

## Scope

Keep the chat sidebar history search input visually synchronized with the parent `historySearch` state.

## Changes

- Added a `historySearch` prop to `ChatSidebar`.
- Bound the sidebar search input value to that prop while preserving the existing `update:historySearch` input event.
- Passed `historySearch` from `ChatView` into `ChatSidebar`, making the input controlled by the same state that filters conversations.

## Changed Files

- `frontend/src/components/chat/ChatSidebar.vue`
- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-sidebar-search-control.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).
- PASS: `node scripts/check-encoding.mjs` after report update.

## Next Recommended Task

Continue auditing chat drawers for parent-owned subpanel state, especially status/accessory editor open states that should close or refresh when the active conversation context changes.
