# CharacterFormView AI Panel RAF Layout

## Summary

Coalesced high-frequency AI panel layout work in `CharacterFormView` so window resize and `ResizeObserver` callbacks schedule a single animation-frame sync instead of reading, writing, and saving layout state on every event.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
  - Split AI panel size/position sync into frame-scheduled helpers.
  - Kept the first `ResizeObserver` event ignored and kept mobile-width size sync skipped.
  - Cancels pending animation-frame layout work on unmount.
- `backend/src/tests/frontendCharacterFormView.test.js`
  - Added source coverage for RAF coalescing and unmount cancellation.
- `automation/backlog.md`
  - Recorded the completed iteration.

## Validation

- `node --test backend\src\tests\frontendCharacterFormView.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` passed with CRLF warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed.
  - Backend: 534 tests passed.
  - Frontend build: passed.
  - Encoding and diagnostic checks: passed.

## Notes

Parallel worktree changes were observed during the run in `backend/src/modules/statusBars.js`, `backend/src/modules/tags.js`, `backend/src/tests/frontendChatComposer.test.js`, `frontend/src/styles.css`, `backend/src/routes/auth.js`, and several existing reports. This iteration did not intentionally modify those files.

## Next Recommended Task

Continue the UI/state audit by checking remaining high-frequency handlers, especially drag or pointer-move paths, for unnecessary synchronous layout reads and writes.
