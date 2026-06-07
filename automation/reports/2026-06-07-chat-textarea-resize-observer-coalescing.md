# Chat Textarea Resize Observer Coalescing

Date: 2026-06-07

## Scope

Reduce repeated chat composer textarea measurement work when ResizeObserver fires rapidly.

## Changes

- Added a `scheduleTextareaResizeUpdate()` RAF gate in `ChatView.vue`.
- Routed the textarea `ResizeObserver` callback through the scheduler instead of reading `offsetHeight` immediately on every observer notification.
- Kept `handleTextareaResize()` as the single measurement/update path for user-resized textarea state.
- Canceled pending textarea resize frames through the existing composer layout cleanup path.

## Changed Files

- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-textarea-resize-observer-coalescing.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed; scanned 473 files.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 474 files.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only touched ChatView textarea ResizeObserver scheduling, the autonomous backlog, and this report.

## Next Recommended Task

Continue auditing ResizeObserver and scroll handlers in chat-adjacent panels for redundant layout reads.
