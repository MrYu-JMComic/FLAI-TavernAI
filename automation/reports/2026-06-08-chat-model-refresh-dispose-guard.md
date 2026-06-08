# 2026-06-08 Chat Model Refresh Dispose Guard

## Summary

Chat quick-model refresh completions now share the same explicit unmount guard as quick-model saves, preventing a late refresh response from clearing model-switcher loading state or showing notifications after `ChatView` has been disposed.

## Changed Files

- `frontend/src/views/ChatView.vue`
  - Added `!chatViewDisposed` to `isCurrentModelRefresh()` before accepting refresh completions.
- `backend/src/tests/frontendChatModelSwitcher.test.js`
  - Added source coverage that keeps the model refresh guard aligned with the unmount-safe save path.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendChatModelSwitcher.test.js` in `backend` (5 tests passed)
- PASS: `node scripts/check-encoding.mjs` (scanned 532 files)
- PASS: `git diff --check`
- PASS: `npm.cmd test` in `backend` (831 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Continue auditing `ChatView.vue` route and conversation-change async paths for state writes that rely on indirect token invalidation instead of an explicit disposed or context guard.
