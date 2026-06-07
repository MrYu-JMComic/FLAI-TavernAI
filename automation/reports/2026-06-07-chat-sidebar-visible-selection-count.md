# Chat Sidebar Visible Selection Count

Date: 2026-06-07

## Scope

Keep ChatSidebar bulk-selection UI aligned with the currently visible filtered conversation list.

## Changes

- Updated `selectedConversationCount` to count only selected IDs that are currently visible after filtering.
- This keeps the batch-delete button disabled when no visible conversations are selected.
- Hidden selections can still be preserved and reappear when the filter changes, but they no longer make the current filtered view look actionable.

## Changed Files

- `frontend/src/composables/chat/useChatConversation.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-sidebar-visible-selection-count.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).
- PASS: `node scripts/check-encoding.mjs` after report update.

## Next Recommended Task

Continue auditing sidebar and composer list-driven state for hidden selections, stale selected IDs, and actions that can become no-ops after filters change.
