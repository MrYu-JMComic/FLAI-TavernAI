# 2026-06-07 Chat Model Switcher Handler Busy Guard

## Goal

Prevent model refresh and model save handlers from accepting duplicate events while model switcher work is already pending.

## Changes

- Added a parent-level guard to `refreshQuickModels()` so refresh events are ignored while a refresh or save is pending.
- Added a parent-level guard to `saveQuickModel()` so duplicate save events cannot queue overlapping provider setting saves before the child prop update lands.
- Extended focused source coverage to verify the model switcher UI lock is backed by matching ChatView handler guards.

## Files Touched

- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatModelSwitcher.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatModelSwitcher.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 469 backend tests and the frontend build.

## Notes

- Existing ChatModelSwitcher UI lock changes in the worktree were preserved and not rewritten.
