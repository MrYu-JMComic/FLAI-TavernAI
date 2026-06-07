# Chat Scroll Timer Cleanup

Date: 2026-06-07

## Scope

Tighten chat scroll state updates during streaming output and route teardown so old animation frames or timers cannot update a destroyed chat view.

## Changes

- Added a disposed guard to the chat scroll composable.
- Coalesced repeated `scrollToBottom()` animation frames so fast streamed chunks keep only the latest pending scroll request.
- Coalesced delayed smooth-scroll state refreshes instead of leaving multiple 360ms timers queued.
- Tracked restore-scroll animation frames separately and cancel older restore work when a newer restore is scheduled.
- Expanded cleanup to cancel scroll-save timers, smooth-scroll timers, scroll-to-bottom RAFs, and restore RAFs.

## Changed Files

- `frontend/src/composables/chat/useChatScroll.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-scroll-timer-cleanup.md`

## Validation

- PASS: `node scripts/check-encoding.mjs` (scanned 443 files before this report).
- PASS: final `node scripts/check-encoding.mjs` after adding this report (scanned 445 files).
- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check passed; Vite production build passed).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed: 441/441.
  - Frontend build passed.

## User Change Safety

The worktree already had many modified and untracked files. This run only edited the chat scroll composable, updated the backlog Done list, and added this report.

## Next Recommended Task

Continue auditing chat-level delayed callbacks, especially composer dock RAFs and pending nextTick callbacks that can fire after route teardown.
