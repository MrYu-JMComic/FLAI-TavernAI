# 2026-06-08 Conversation Message List Direct Loop

## Goal

Keep chat message-list reads cheap and predictable when loading conversations with long histories.

## Changed Files

- `backend/src/routes/conversations.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`

## Changes

- Replaced the `getMessages()` `filter(...).map(...)` pipeline with one displayable-row loop.
- Preserved the existing route ordering and empty-assistant filtering behavior.
- Added source-level regression coverage beside the existing insertion-order route test.

## Validation

- PASS: `node --test backend\src\tests\backend.test.js` (276 tests passed)
- PASS: `npm.cmd test` in `backend` (824 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next

- Continue reviewing chat route list helpers for repeated allocations only where the path is user-visible or request-hot.
