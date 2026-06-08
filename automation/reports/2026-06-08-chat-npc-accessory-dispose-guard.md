# 2026-06-08 Chat NPC Accessory Dispose Guard

## Summary

NPC accessory refresh polling and fingerprint sync now stop writing ChatView state after the view is disposed, covering delayed `fetchConversationNpcs()` completions that can outlive submit cleanup timers.

## Changed Files

- `frontend/src/views/ChatView.vue`
  - Added explicit `chatViewDisposed` checks to NPC accessory refresh entry, post-fetch completion, final cleanup, and fingerprint sync paths.
- `backend/src/tests/frontendChatAccessory.test.js`
  - Added source coverage for the disposed guards and updated existing scoped-cleanup assertions.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendChatAccessory.test.js` in `backend` (26 tests passed)
- PASS: `node scripts/check-encoding.mjs` (scanned 533 files)
- PASS: `git diff --check`
- PASS: `npm.cmd test` in `backend` (832 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Continue auditing ChatView event handlers that can receive late callbacks after route changes or unmounts, especially status badge and panel refresh paths that are not tokenized.
