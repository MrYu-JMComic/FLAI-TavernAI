# 2026-06-04 Chat Header Title Removal

## Summary

- Removed the centered chat header title and provider/model subtitle from the chat page.
- Removed the obsolete provider/model props from `ChatHeader`.
- Kept the left navigation controls and right utility actions visible.
- Reduced the mobile chat header height now that the center title block is gone.

## Changed Files

- `frontend/src/components/chat/ChatHeader.vue`
- `frontend/src/views/ChatView.vue`
- `frontend/src/styles.css`

## Validation

- `node scripts/check-encoding.mjs`: PASS
- `npm.cmd run build` in `frontend`: PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS

## Notes

- The working tree already contains many unrelated modified and untracked files; this run only targeted the chat header title display.
- Vite still reports the existing large chunk warning for `StatusBar`, but the build succeeds.
