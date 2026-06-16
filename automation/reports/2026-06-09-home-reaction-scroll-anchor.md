# 2026-06-09 - Home Reaction Scroll Anchor

## Changed Files

- `frontend/src/views/HomeView.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/reports/2026-06-09-home-reaction-scroll-anchor.md`

## Summary

- Disabled browser scroll anchoring for the home internal scroller, sticky controls, and character list nodes so reaction state updates cannot move the viewport.
- Removed dynamic TanStack row measurement from the desktop home virtualizer; row positions now stay on the fixed estimate instead of being recalculated after card rerenders.
- Matched virtualized card height to the row estimate so the fixed virtualizer spacing remains stable.

## Coverage

- Added a HomeView source test that forbids `measureElement` and `measureVirtualRow` in the home list.
- Added CSS assertions that the home scroller/list nodes opt out of `overflow-anchor`, the nested virtual scroller contains overscroll, and virtual cards keep the fixed row height.

## Validation

- PASS: `node --test src/tests/frontendHomeView.test.js src/tests/frontendAppRipple.test.js src/tests/frontendBaseLayout.test.js`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `git diff --check` (CRLF warnings only).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
