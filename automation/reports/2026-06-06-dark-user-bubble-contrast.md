# Dark User Bubble Contrast

## Summary

- Fixed dark-theme user chat bubbles so they no longer use a translucent light background.
- Added a 90% opacity dark fallback color and a subtle dark-theme treatment for readable contrast over custom light chat backgrounds.
- Kept the light-theme user bubble behavior unchanged.

## Changed Files

- `frontend/src/styles.css`

## Validation

- `node scripts/check-encoding.mjs` - passed
- `npm.cmd run build` in `frontend` - passed

## Review Gate

- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` - passed

## Notes

- The working tree contains many pre-existing modified and untracked files. This iteration only targeted the dark-theme user chat bubble contrast.
