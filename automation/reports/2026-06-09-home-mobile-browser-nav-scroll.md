# 2026-06-09 - Home Mobile Browser Navigation Scroll

## Changed Files

- `frontend/src/components/BaseLayout.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendBaseLayout.test.js`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/reports/2026-06-09-home-mobile-browser-nav-scroll.md`

## Summary

- Added a home-route layout class so the homepage can use a fixed app viewport like the chat route.
- Constrained the homepage shell to `100dvh` and moved homepage scrolling into `.page-shell`.
- Kept the browser window itself from becoming the scroll container, preventing mobile Chrome from collapsing the browser navigation bar while browsing the homepage.
- Corrected the mobile search/sort sticky offset so it uses the top of the internal `.page-shell` scroller and visually pins to the app topbar edge.
- Stabilized the mobile homepage shell on `100svh` and disabled internal over-scroll feedback to stop bottom-of-list drag jitter.
- Moved the homepage top spacing from the scroll container to the home content stack so the sticky filter bar can actually reach the scrollport top.
- Themed the homepage internal scrollbar with a thin track and gradient thumb to match the dark workbench surface.
- Removed the stable scrollbar gutter on narrow mobile home layouts and slimmed the mobile scrollbar so the workbench content no longer appears horizontally offset.
- Removed transform-based hover, focus, and active states from the home workbench controls and cards because transformed descendants were changing the internal scroller's scrollable overflow and causing bottom snap-back.

## Coverage

- Added a BaseLayout source test that guards the home fixed-shell class and internal scroll CSS contract.
- Added a HomeView source test that prevents mobile filter controls from adding the app topbar height twice.
- Added a HomeView source test that prevents the home workbench scroll surface from reintroducing transform-based interaction states or enlarged hover shadows.

## Validation

- PASS: `node scripts/check-encoding.mjs`.
- PASS: `node --test src/tests/frontendBaseLayout.test.js` in `backend`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Recheck other non-chat mobile routes for browser-window scrolling and decide whether they should share the same fixed-shell pattern.
