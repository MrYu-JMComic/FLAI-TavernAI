# Chat Accessory Stale Refresh Guard

## Summary

- Added independent request token guards for chat accessory status bar, economy balance, and accessory skill loads.
- Preserved the existing conversation ID checks while also blocking older same-conversation refreshes from overwriting newer state.
- Recorded the iteration in `automation/backlog.md`.

## Changed Files

- `frontend/src/composables/chat/useChatAccessory.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-accessory-stale-refresh-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 403 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 403 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 435/435.
  - Frontend production build passed.
  - Git status reported the existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 403 files.

## Next Recommended Task

- Continue reviewing chat composables for same-route refresh races after mutations, especially paths that reload data after a save or streamed tool result.
