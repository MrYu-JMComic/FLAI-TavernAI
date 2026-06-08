# 2026-06-09 - Chat Appearance Script Wait Guard

## Changed Files

- `frontend/src/utils/chatAppearance.js`
- `frontend/src/composables/chat/useChatAppearance.js`
- `backend/src/tests/frontendChatAppearance.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-appearance-script-wait-guard.md`

## Summary

- Routed chat custom-script `wait()` and `requestPaint()` through the scoped helpers supplied by the appearance composable instead of always using global timers.
- Added stale apply-token checks before and after custom-script timeout and animation-frame waits so scripts do not resume into an old conversation and write stale UI state.
- Added coverage for stale timeout and RAF resumes that would otherwise directly mutate old root/style or script state.

## Validation

- PASS: `node --test src/tests/frontendChatAppearance.test.js` in `backend` (18 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 562 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (856 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

- Continue auditing delayed custom-script and layout helper resumes for token checks after `nextTick`, RAF, and timeout boundaries.
