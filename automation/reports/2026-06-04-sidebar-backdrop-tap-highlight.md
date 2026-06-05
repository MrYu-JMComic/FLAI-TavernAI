# 2026-06-04 Sidebar Backdrop Tap Highlight

## Summary

- Removed mobile tap highlight from the chat sidebar backdrop button.
- Normalized the sidebar backdrop color to a neutral smoky overlay instead of a blue-tinted click layer.
- Kept hover, focus, and active backdrop states visually consistent so tapping the overlay no longer flashes a blue cover.

## Changed Files

- `frontend/src/styles.css`

## Validation

- `node scripts/check-encoding.mjs`: PASS
- `npm.cmd run build` in `frontend`: PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS

## Notes

- The working tree already contains many unrelated modified and untracked files; this run only targeted the sidebar backdrop visual fix.
- Vite still reports the existing large chunk warning for `StatusBar`, but the build succeeds.
