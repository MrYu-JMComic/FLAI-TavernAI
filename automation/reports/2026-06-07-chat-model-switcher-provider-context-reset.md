# Chat Model Switcher Provider Context Reset

Date: 2026-06-07

## Scope

Keep the model switcher draft selection aligned with the active provider context while the dialog is open.

## Changes

- Added a provider context key in `ChatModelSwitcher.vue` from provider type, gateway name, base URL, reasoning support, and extra body.
- Reset search text and draft model when the switcher opens or the provider context changes.
- Kept current-model synchronization for cases where the draft is still following the previous current model.
- Preserved user-selected draft models when the provider context remains the same.

## Changed Files

- `frontend/src/components/chat/ChatModelSwitcher.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-model-switcher-provider-context-reset.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed; scanned 475 files.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 477 files.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only touched the chat model switcher draft synchronization, the autonomous backlog, and this report.

## Next Recommended Task

Continue auditing dialogs and drawers with local draft state derived from props, especially when their parent context can change while the UI remains open.
