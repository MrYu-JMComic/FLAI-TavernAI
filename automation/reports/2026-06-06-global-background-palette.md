# Global Background Palette

## Changed Files

- `frontend/src/styles.css`

## Summary

- Reworked the light theme from the old beige/red-green wash to a cleaner mist-green and warm-white palette.
- Added shared `--app-bg`, `--chat-shell-bg`, and `--chat-sidebar-bg` variables so page backgrounds stay consistent across normal pages and the chat layout.
- Updated chat shell, sidebar, and settings drawer background/border colors to use the global palette instead of hard-coded white/cold blue backgrounds.
- Refreshed dark theme background variables to match the same muted green-gray direction.

## Validation

- `node scripts/check-encoding.mjs` passed.
- `npm.cmd run build` in `frontend` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed, including 356 backend tests and the frontend build.

## Next Recommended Task

- Review the main pages in light and dark mode on desktop and mobile, then tune individual component accents only where the new background exposes contrast issues.
