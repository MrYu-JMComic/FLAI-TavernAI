# Chat Submit Cleanup Abort

Date: 2026-06-07

## Scope

Close a chat-submit teardown gap where active stream/send completions could continue mutating a destroyed chat view.

## Changes

- Added a submit run id and disposed flag to the chat submit composable.
- Made cleanup abort the active stream controller, clear submit busy state, and invalidate the current submit run.
- Guarded stream callbacks, non-stream completions, accessory refresh scheduling, and persisted-draft reconciliation against disposed or stale submit runs.
- Preserved the existing user stop flow; the disposed guard is only set from the chat view cleanup path.

## Changed Files

- `frontend/src/composables/chat/useChatSubmit.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-submit-cleanup-abort.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 448 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 448 files before final report update).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).

## Next Recommended Task

Continue auditing chat composables for async completions that depend on destroyed route or component state.
