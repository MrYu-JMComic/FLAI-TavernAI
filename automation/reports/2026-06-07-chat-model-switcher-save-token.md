# Chat Model Switcher Save Token

Date: 2026-06-07

## Scope

Prevent the quick model switcher from keeping stale saving or refreshing UI state when the provider context changes mid-operation.

## Changes

- Added a model-save token in ChatView so stale save completions cannot update the current provider UI.
- Cleared only the latest save's saving state, avoiding older save completions racing newer saves.
- Invalidated in-flight model refresh and save work when the provider context changes, clearing stale spinner state.

## Changed Files

- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-model-switcher-save-token.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).
- PASS: `node scripts/check-encoding.mjs` after report update.

## Next Recommended Task

Continue auditing provider and route transition state, especially sidebar selection and any dialog that blocks close while an async action is running.
