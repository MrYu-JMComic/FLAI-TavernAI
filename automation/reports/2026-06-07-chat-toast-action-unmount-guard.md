# Chat Toast Action Unmount Guard

Date: 2026-06-07

## Scope

Prevent delayed notification action clicks from dispatching navigation through an already-unmounted ChatView instance.

## Changes

- Updated `ChatView.vue` so provider/settings error toasts use a dedicated settings navigation callback.
- Reused the existing `chatViewDisposed` lifecycle guard before emitting `navigate`.
- Preserved the existing toast label, duration, and settings navigation behavior while the chat view is still mounted.

## Changed Files

- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-toast-action-unmount-guard.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed; scanned 462 files.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 464 files.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only changed the ChatView toast action callback and the autonomous backlog/report records.

## Next Recommended Task

Continue auditing delayed UI callbacks that capture component emit handlers, especially callbacks stored in global providers or long-lived services.
