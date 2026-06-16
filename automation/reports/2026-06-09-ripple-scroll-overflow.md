# 2026-06-09 - Ripple Scroll Overflow

## Changed Files

- `frontend/src/styles.css`
- `backend/src/tests/frontendAppRipple.test.js`
- `automation/reports/2026-06-09-ripple-scroll-overflow.md`

## Summary

- Replaced the global click ripple's oversized transformed pseudo-element with an inset radial-gradient overlay.
- Removed the transient active-state `overflow: hidden` toggle from ripple targets so flex item sizing cannot change during pointerdown.
- Stabilized home favorite/like button widths and count digits so response count changes do not move the click target.
- Kept the pointer-position visual feedback while preventing ripple geometry from contributing to parent scrollable overflow.
- Addressed the remaining home card favorite/like snap-back path at the shared interaction layer instead of per-button styling.

## Coverage

- Added an App ripple source test that requires the ripple pseudo-element to stay inset within the target, keeps target positioning stable before activation, and forbids transformed width/height or active overflow geometry.
- Added a HomeView source test that keeps reaction buttons width-stable while counts update.

## Validation

- PASS: `node scripts/check-encoding.mjs`.
- PASS: `node --test src/tests/frontendAppRipple.test.js src/tests/frontendHomeView.test.js`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
