# Personal Center Redesign Plan

## Objective

Replace the main-navigation preset destination with Personal Center, redesign it as a compact overview with links to dedicated account pages, and hide the bottom navigation on those detail pages.

## Scope

- Update desktop and mobile main navigation so the Personal Center is the account destination.
- Keep conversation presets reachable from Personal Center and remove them from Extension Management.
- Give profile, presets, model gateway, and data export dedicated routes and page layouts.
- Keep `/presets` working as a compatibility redirect to the dedicated preset page.
- Redesign Personal Center as a compact identity and stats summary followed by direct destination rows.
- Hide the mobile bottom navigation on account detail routes and other secondary pages while retaining it on the top-level library/create/world-book/personal destinations.
- Keep all current profile and preset actions, including import/export, default selection, and the last-preset deletion guard.

## Implementation Decisions

- `/settings` is a read-only overview with a compact identity summary, three account statistics, and four destination rows.
- Profile, presets, provider, and data export routes render only their own panel and include a return action to `/settings`.
- Load profile data only on the overview and profile routes, provider configuration only on the provider route, and presets only on the presets route.
- Keep the existing extension section navigation and cleanup the obsolete personal anchor navigation and anchor-specific styles.
- The mobile bottom navigation appears on the top-level home, create, world-book library, and Personal Center routes only.

## Checklist

- [x] Replace preset navigation with Personal Center and preserve selected-state behavior.
- [x] Replace the embedded personal settings sections with a compact Personal Center overview and destination rows.
- [x] Add dedicated account routes for profile, presets, model gateway, and data export.
- [x] Move the preset management panel from Extension Management to its dedicated Personal Center route.
- [x] Redirect the legacy route and remove duplicate preset code and exclusive styles after reference checks.
- [x] Hide bottom navigation on all secondary pages and add back navigation to Personal Center details.
- [x] Update source and end-to-end tests for navigation, route ownership, and legacy route behavior.
- [x] Run frontend build, focused tests, encoding check, and diff checks.
- [x] Capture and inspect Personal Center screenshots at 519x930, desktop, and a narrow mobile viewport; record paths and results.

## Acceptance Criteria

- Main navigation displays `个人` and opens the compact `/settings` overview.
- Personal Center shows concise identity/stats information and destination rows for profile, presets, model gateway, and data export.
- Each destination opens its own route; secondary pages have no mobile bottom navigation and provide a return path where appropriate.
- Conversation presets are available from Personal Center and absent from Extension Management navigation.
- `/presets` redirects to the dedicated preset page without rendering duplicate preset logic.
- The profile detail keeps avatar upload, account name, display name, permission, profile save, stats, and owned-AI rows accessible without overlap or horizontal overflow.
- Preset create/edit/delete/default/import/export actions remain available, and the final preset cannot be deleted.
- Frontend build and relevant tests pass; source encoding check and diff checks pass.
- Desktop and mobile screenshots show a coherent layout with no clipping, overlap, or horizontal overflow.

## Validation Commands

- `npm run build` from `frontend`
- `npm run test:unit -- --run` from `frontend` for any affected component-level coverage
- `node --test src/tests/frontendBaseLayout.test.js src/tests/frontendSettingsView.test.js src/tests/frontendAppRoute.test.js` from `backend`
- `node scripts/check-encoding.mjs` from the repository root
- `git diff --check`
- Run the focused Playwright Personal Center flow and inspect screenshots at 1440x900, 519x930, and 320x844.

## Validation Results

- `npm run build` from `frontend` passed; Vite reported the existing large-chunk advisory.
- Focused route, layout, and settings tests passed (28 tests); the Personal Center Playwright flow passed.
- Backend full test suite passed (1665 tests).
- `node scripts/check-encoding.mjs` and `git diff --check` passed.
- Captured and inspected Personal Center at 1440x900, 519x930, and 320x844, plus profile, presets, provider, and data detail pages. No clipping, overlap, or horizontal overflow was observed.
- Screenshots: `.runtime-check/playwright-results/personal-center-Personal-C-3e972-t-desktop-and-mobile-widths-chromium/` (`personal-center-1440x900.png`, `personal-center-519x930.png`, `personal-center-320x844.png`, `personal-center-profile.png`, `personal-center-presets.png`, `personal-center-provider.png`, and `personal-center-data.png`).
