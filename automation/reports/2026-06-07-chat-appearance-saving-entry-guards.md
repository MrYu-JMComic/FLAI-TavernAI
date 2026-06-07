# 2026-06-07 Chat Appearance Saving Entry Guards

## Goal

Prevent programmatic chat appearance background upload or clear events from mutating the appearance draft while an appearance save is already pending.

## Changes

- Added an `appearanceSaving` guard to the chat appearance background upload entry before upload tokens are advanced.
- Added the same saving guard to background clear actions so clear events cannot bypass the disabled settings UI.
- Added focused source coverage to keep saving events from invalidating active upload tokens before they are ignored.

## Files Touched

- `frontend/src/composables/chat/useChatAppearance.js`
- `backend/src/tests/frontendChatAppearance.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendChatAppearance.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 471 backend tests and the frontend build.

## Notes

- Existing dirty worktree changes were preserved.
- This iteration intentionally avoided changing broader appearance save semantics or adding a new upload state.
