# AI Panel Resize Edge Clamp

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/styles.css`

## Summary

- Changed the AI draft panel resize max width and height to use the panel's current position, so resizing can reach the right and bottom viewport edges instead of stopping 32px early.
- Updated the drag clamp to use the panel's measured size after resize, avoiding stale saved dimensions when calculating edge positions.
- Preserved the top clamp against the sticky topbar so the drag handle stays reachable.

## Validation

- `node scripts/check-encoding.mjs` passed.
- `npm.cmd run build` in `frontend` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed, including 356 backend tests and the frontend build.

## Next Recommended Task

- Manually resize the AI draft panel larger, then drag it to the left, right, and bottom edges on `/#/characters/new` to confirm it remains flush after resizing.
