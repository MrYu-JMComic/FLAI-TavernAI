# Chat Model Refresh Stale Guard

## Summary

- Added a request token guard for the chat model switcher's provider model refresh.
- Captured a provider configuration key before refreshing models.
- Ignored stale refresh completions, errors, notifications, and loading-state updates when a newer refresh starts or provider settings change.
- Recorded the iteration in `automation/backlog.md`.

## Changed Files

- `frontend/src/views/ChatView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-model-refresh-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 404 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 404 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 435/435.
  - Frontend production build passed.
  - Git status reported the existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 404 files.

## Next Recommended Task

- Continue reviewing user-triggered refresh and save flows for overlapping-request state races.
