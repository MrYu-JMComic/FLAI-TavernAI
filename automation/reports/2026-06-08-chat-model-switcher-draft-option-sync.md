# ChatModelSwitcher Draft Option Sync

Date: 2026-06-08

## Summary

- Kept the open model switcher draft model scoped to the refreshed model option list.
- Blocked stale model ids from being selected or saved after provider model options change.
- Added direct-loop option lookup coverage for the draft synchronization path.

## Changed Files

- `frontend/src/components/chat/ChatModelSwitcher.vue`
- `backend/src/tests/frontendChatModelSwitcher.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-chat-model-switcher-draft-option-sync.md`

## Validation

- `node --test backend\src\tests\frontendChatModelSwitcher.test.js` - pass, 4 tests.
- `node scripts/check-encoding.mjs` - pass.
- `npm.cmd run build` in `frontend` - pass.
- `npm.cmd test` in `backend` - pass.
- `git diff --check` - pass with CRLF warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` - PASS.

## Notes

- Existing unrelated dirty files and untracked reports were preserved.
- Recommended next task: continue reviewing open dialogs where refreshed option lists can leave stale drafts selected.
