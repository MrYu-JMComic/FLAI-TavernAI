# Chat Accessory Unmount Guard

Date: 2026-06-07

## Scope

Closed stale async completion gaps in the chat accessory composable after ChatView teardown.

## Changes

- Added an explicit disposed state and cleanup function to `useChatAccessory`.
- Invalidated status bar, economy, accessory skill load, and accessory mutation tokens during cleanup.
- Included disposed checks in accessory load, save, status bar mutation, and skill-result completion paths.
- Wired `cleanupAccessory` into `ChatView` unmount cleanup.

## Changed Files

- `frontend/src/composables/chat/useChatAccessory.js`
- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-accessory-unmount-guard.md`

## Validation

- PASS: `git diff --check` completed with only existing CRLF normalization warnings.
- PASS: `npm.cmd run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.

## Next Recommended Task

Continue reviewing composables with token checks that lack an explicit teardown state, especially those returning callbacks used by ChatView.
