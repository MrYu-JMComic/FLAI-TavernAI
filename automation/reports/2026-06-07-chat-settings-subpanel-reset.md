# Chat Settings Subpanel Reset

Date: 2026-06-07

## Scope

Prevent ChatSettingsDrawer child UI state from staying open across drawer closes or active conversation changes.

## Changes

- Added a `closeAccessoryPanels` helper in the chat accessory composable.
- The helper closes the status bar editor and accessory-skills expansion without changing saved settings.
- Wired ChatView to close those subpanels when the settings drawer closes or when the active conversation ID changes.

## Changed Files

- `frontend/src/composables/chat/useChatAccessory.js`
- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-settings-subpanel-reset.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).
- PASS: `node scripts/check-encoding.mjs` after report update.

## Next Recommended Task

Continue auditing parent-owned dialog state for stale open/editing flags, especially model switcher and message editing flows during route or provider changes.
