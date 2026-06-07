# 2026-06-07 Character Image Upload Panel Busy

## Goal

Prevent duplicate character-image upload events from invalidating an in-flight upload and keep image mutations from overlapping with uploads.

## Changes

- Added a shared `imagePanelBusy` computed state for upload and image mutation busy checks.
- Moved the duplicate-upload guard before `imageUploadToken` is incremented, so ignored upload events do not mark the active upload as stale.
- Reused the shared panel busy state for upload button disabled styling and image action disabling.
- Tightened focused source coverage for the upload guard ordering and shared busy binding.

## Files Touched

- `frontend/src/components/CharacterImagePanel.vue`
- `backend/src/tests/frontendCharacterImagePanel.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendCharacterImagePanel.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 465 backend tests and the frontend build.

## Notes

- Internal `loadImages()` refreshes remain unguarded by the panel busy state, so post-upload and post-mutation refreshes can still complete normally.
