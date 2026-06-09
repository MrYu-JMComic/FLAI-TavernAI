# Character AI Panel Resize Restore

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-character-ai-panel-resize-restore.md`

## Summary

- Restored native desktop `resize: both` support for the floating character AI draft panel while keeping the custom resize handle.
- Added a `ResizeObserver` path that coalesces measured panel size updates and persists the resized width and height to the existing AI panel localStorage state.
- Aligned desktop CSS minimum width and height with the JavaScript resize limits so native and custom resizing share the same bounds.
- Updated the CharacterFormView source test to lock the native resize and measured-size persistence contract.

## Validation

- PASS: `node --test src/tests/frontendCharacterFormView.test.js` in `backend` (17 tests).
- PASS: `npm.cmd run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` (includes 866 backend tests and frontend build).

## Next Recommended Task

- Manually resize the floating AI panel from the browser corner and the custom handle on `/#/characters/new`, then reload to confirm the size persists.
