# AI Panel Topbar Clamp

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/styles.css`

## Summary

- Clamped the desktop AI draft panel position below the sticky topbar instead of allowing it to sit at the top edge of the viewport.
- Re-clamped saved panel positions on page mount, resize, resize-observer updates, and reset so old localStorage coordinates recover automatically.
- Raised the AI draft panel above the topbar and disabled touch scrolling on the drag handle for more reliable dragging.

## Validation

- `node scripts/check-encoding.mjs` passed.
- `npm.cmd run build` in `frontend` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed, including 356 backend tests and the frontend build.

## Next Recommended Task

- Manually drag the AI draft panel near the top edge on `/#/characters/new` while signed in and confirm it settles below the navigation bar.
