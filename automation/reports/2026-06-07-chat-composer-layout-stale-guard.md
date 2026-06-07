# Chat Composer Layout Stale Guard

Date: 2026-06-07

## Scope

Harden ChatView-level composer layout work and quick model saves so delayed callbacks cannot write UI state after the chat view has been destroyed.

## Changes

- Added a ChatView disposed guard that is checked by composer textarea sizing, viewport resize handling, dock layout updates, and NPC feature watchers.
- Stopped the async `onMounted` continuation from binding window events or creating resize observers if the route changes before initial chat loads finish.
- Coalesced composer layout `nextTick` work so repeated input changes schedule one pending layout update while preserving quick-reply focus.
- Canceled pending composer dock RAF and textarea autosize RAF during unmount.
- Guarded quick-model save completions against unmounted views or provider context changes before notifying or emitting `provider-saved`.

## Changed Files

- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-composer-layout-stale-guard.md`

## Validation

- PASS: `node scripts/check-encoding.mjs` (scanned 445 files before this report).
- PASS: final `node scripts/check-encoding.mjs` after adding this report (scanned 447 files).
- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check passed; Vite production build passed).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed: 441/441.
  - Frontend build passed.

## User Change Safety

The worktree already had many modified and untracked files. This run only edited ChatView's lifecycle/layout guards, updated the backlog Done list, and added this report.

## Next Recommended Task

Continue auditing chat-level async completions around branch/save-panel reload callbacks and any remaining global event paths.
