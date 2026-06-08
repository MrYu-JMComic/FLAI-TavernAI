# 2026-06-08 Character Upload Token Validation

## Summary

Character form avatar/background uploads and character image panel uploads now invalidate their upload tokens only after selected files pass presence, type, and size validation. Invalid or canceled file selections no longer suppress a still-pending valid upload read or hide an active background-read state.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
  - Moved avatar upload token creation after file validation.
  - Moved advanced background upload token creation after file validation and left invalid selections from clearing active background upload state.
- `frontend/src/components/CharacterImagePanel.vue`
  - Collected valid upload files before starting upload state or invalidating the active upload token.
- `backend/src/tests/frontendCharacterFormView.test.js`
  - Added source coverage for upload validation before token invalidation.
- `backend/src/tests/frontendCharacterImagePanel.test.js`
  - Added source coverage for image-panel upload validation before upload state starts.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendCharacterFormView.test.js` in `backend` (16 tests)
- PASS: `node --test src/tests/frontendCharacterImagePanel.test.js` in `backend` (7 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 537 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (835 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Continue auditing remaining upload and FileReader paths for token invalidation or busy-state updates that can discard valid pending reads after harmless invalid input.
