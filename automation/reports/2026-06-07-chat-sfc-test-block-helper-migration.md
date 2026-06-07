# 2026-06-07 Chat SFC Test Block Helper Migration

## Goal

Continue reducing repeated frontend SFC source-test setup after adding the shared block reader.

## Changes

- Migrated ChatHeader, ChatMessageItem, and ChatModelSwitcher source tests to `readVueBlocks()`.
- Kept plain source reads for non-SFC composables and CSS files.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/tests/frontendChatHeader.test.js`
- `backend/src/tests/frontendChatMessageItem.test.js`
- `backend/src/tests/frontendChatModelSwitcher.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-sfc-test-block-helper-migration.md`

## Validation

- Passed: `node --test backend\src\tests\frontendChatHeader.test.js backend\src\tests\frontendChatMessageItem.test.js backend\src\tests\frontendChatModelSwitcher.test.js`
- Passed: `node scripts\check-encoding.mjs`
- Passed: `git diff --check` with LF/CRLF conversion warnings only and no whitespace errors.
- Passed: `git diff --cached --check`
- Passed: `npm run build` in `frontend`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` after a transient concurrent Settings test mismatch was no longer present (505 backend/source tests and frontend build)

## Notes

- This is a test-maintenance refactor only; no product runtime code changed.
- Existing parallel Chat, Settings, and StatusBar worktree changes were preserved.
