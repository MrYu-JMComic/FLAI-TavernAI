# 2026-06-07 Chat Sidebar Stale Load Guard

## Backlog Item

- Improve empty, loading, and error states in the Vue views.
- Improve frontend API error handling and user-facing messages.

## Changes

- Added a request token guard to `loadSidebarData()` so older sidebar loads cannot overwrite newer conversation sidebar state after route/conversation changes.
- Added regression coverage for a slow old sidebar request returning after a newer request.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendChatConversation.test.js` in `backend`.
  - Chat sidebar focused tests passed: 2/2.
- PASS: `node --test src\tests\test-hygiene.test.js` in `backend`.
  - Test hygiene focused checks passed: 3/3.
- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 398 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 398 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 435/435.
  - Frontend production build passed.
  - Git status reported an existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 398 files.

## Notes

- The existing worktree already contained many unrelated modified and untracked files; this run intentionally touched only `frontend/src/composables/chat/useChatConversation.js`, `backend/src/tests/frontendChatConversation.test.js`, `automation/backlog.md`, and this report.
