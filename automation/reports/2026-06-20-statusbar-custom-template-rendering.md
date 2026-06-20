# 2026-06-20 Status Bar Custom Template Rendering

## Objective

Fix custom status bar templates so pasted HTML/CSS can control the actual rendered appearance instead of being distorted by the built-in status bar chrome and whitespace rules.

## Changes

- Updated `frontend/src/components/StatusBar.vue` so expanded custom-template status bars no longer inherit the built-in card border, padding, background, shadow, or backdrop blur.
- Changed the custom template wrapper from `white-space: pre-wrap` to `white-space: normal`, preventing pasted template indentation and line breaks from rendering as large vertical gaps.
- Updated `frontend/src/utils/chatAppearance.js` so scoped custom CSS also prefixes the first rule inside nested blocks such as `@media`.
- Added source-level regression coverage in `backend/src/tests/frontendStatusBar.test.js` and `backend/src/tests/frontendChatAppearance.test.js`.

## Validation

- Passed: `node --test backend/src/tests/frontendStatusBar.test.js backend/src/tests/frontendChatAppearance.test.js backend/src/tests/frontendStatusBarTemplateSecurity.test.js`
- Passed: `node scripts/check-encoding.mjs`
- Passed: `cd backend && npm test` (972 tests)
- Passed: `cd frontend && npm run build`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## User Change Safety

The working tree already contained unrelated modified and untracked files before this iteration. This change only touched the status bar custom-template path, the shared CSS scoping helper, focused tests, and this report.

## Next Recommended Task

Add a small browser-level screenshot check for a representative custom status template, including a `<style>` block with `@media`, once the project has a stable component/browser test harness for this UI.
