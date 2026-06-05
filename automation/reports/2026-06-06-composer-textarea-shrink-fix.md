# 2026-06-06 Composer Textarea Shrink Fix

## Scope

Human-directed chat composer fix. The message textarea could grow as content gained more visual rows, but it did not shrink reliably after content was deleted.

## Changed Files

- `frontend/src/views/ChatView.vue`
  - Added a short-lived autosize guard around programmatic textarea height updates.
  - Prevented the textarea `ResizeObserver` from treating automatic height changes as user manual resize events.
  - Preserved the existing manual-resize tracking for real user-driven resize changes.
  - Cleans up the autosize animation frame during component unmount.

## Validation

- `node scripts/check-encoding.mjs` - PASS
- `frontend`: `npm.cmd run build` - PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS
  - Encoding check PASS
  - Backend tests PASS, 231 tests
  - Frontend build PASS

## Risk Notes

- The repository already had many unrelated uncommitted changes before this run. This run only intentionally changed textarea autosize handling in `frontend/src/views/ChatView.vue` and added this report.
- `frontend/src/views/ChatView.vue` already contained unrelated uncommitted changes, so review should focus on the autosize guard variables, `resizeComposerTextarea`, `handleTextareaResize`, and unmount cleanup.

## Next Recommended Task

Open a chat, type enough text to create multiple textarea rows, then delete back to one row and confirm the composer height shrinks immediately while the message list padding updates with it.
