# Extension Nav Scroll Sync

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `frontend/src/styles.css`

## Summary

- Added scroll-spy behavior for the extensions section navigation so the active tab follows the section currently in view.
- Added smooth centering for the active tab inside the horizontal nav.
- Adjusted the extensions nav sticky offset on mobile so it settles below the top bar with softer shadow, blur, and transition styling.

## Validation

- `node scripts/check-encoding.mjs` passed.
- `npm.cmd run build` in `frontend` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed, including backend tests and frontend build.
- Headless Edge could open the local app, but the fresh browser context was redirected to `/login`, so authenticated visual verification of `/#/extensions` was not completed in automation.

## Next Recommended Task

- Verify the authenticated extensions page manually at mobile widths and tune the sticky offset if the top navigation menu is expanded.
