# 2026-06-09 - Chat Stream Append Follow Guard

## Changed Files

- `frontend/src/composables/chat/useChatSubmit.js`
- `backend/src/tests/frontendChatSubmit.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-stream-append-follow-guard.md`

## Summary

- Scoped stream append follow-scrolls to the current submit run so stale route changes cannot trigger chat scrolling after a chunk append tick.
- Rechecked the assistant draft streaming state after `nextTick()` so pressing stop during a stream append cannot cause one last automatic follow-scroll after the visible draft has settled.

## Validation

- PASS: `node --test src/tests/frontendChatSubmit.test.js` in `backend` (27 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 557 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (849 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

- Continue auditing stream and delayed layout callbacks for post-await stale-submit or stopped-state checks.
