# Chat Message Actions Unmount Stale Guard

Date: 2026-06-07

## Scope

Close a chat teardown gap where pending message edit, delete, copy, swipe, branch, or editor-focus completions could update UI state after the chat view unmounted.

## Changes

- Added a disposed flag and message-action generation token to `useChatMessageActions.js`.
- Guarded message edit and delete completions before mutating messages, clearing edit state, showing notices, or refreshing the sidebar.
- Suppressed clipboard success and error notices after cleanup.
- Guarded scroll-anchor restore work around `nextTick` and animation frames.
- Tracked and canceled the pending message-editor focus animation frame.
- Added disposed-aware guards for swipe initialization, swipe generation, and branch reload/action completions.
- Exposed `cleanup()` from the composable and wired it into `ChatView.vue` teardown.

## Changed Files

- `frontend/src/composables/chat/useChatMessageActions.js`
- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-message-actions-unmount-stale-guard.md`

## Validation

- PASS: `node scripts/check-encoding.mjs` before report creation.
  - Scanned 450 files.
- PASS: `npm.cmd run build` in `frontend`.
  - Prebuild encoding check scanned 450 files.
  - Vite production build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 451 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only edited the chat message-actions cleanup path, touched the existing ChatView teardown wiring, updated the backlog Done list, and added this report.

## Next Recommended Task

Continue auditing smaller Vue components such as `VariableEditor.vue` and remaining settings import flows for nextTick/FileReader completions that can outlive their component instance.
