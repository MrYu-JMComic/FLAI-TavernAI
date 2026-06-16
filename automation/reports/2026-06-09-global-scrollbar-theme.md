# 2026-06-09 - Global Scrollbar Theme

## Changed Files

- `frontend/src/styles.css`
- `backend/src/tests/frontendBaseLayout.test.js`
- `automation/reports/2026-06-09-global-scrollbar-theme.md`

## Summary

- Added global scrollbar design tokens for light and dark themes.
- Applied a low-specificity global scrollbar style for Firefox and WebKit browsers.
- Reused the global tokens in existing visible local scrollbars for the home shell, character section navigation, and AI draft panel.
- Preserved existing hidden-scrollbar behavior for section navigation rails and mobile tag rails.

## Coverage

- Added a BaseLayout stylesheet source test that guards theme-aware global scrollbar variables, WebKit scrollbar styling, home scrollbar token usage, and hidden-scrollbar overrides.

## Validation

- PASS: `node scripts/check-encoding.mjs`.
- PASS: `node --test src/tests/frontendBaseLayout.test.js src/tests/frontendCharacterFormView.test.js`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
