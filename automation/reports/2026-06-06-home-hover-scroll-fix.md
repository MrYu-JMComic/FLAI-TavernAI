# 2026-06-06 Home Hover Scroll Fix

## Scope

Human-directed frontend interaction fix. In the in-app browser, the home character area could trap mouse wheel input when the pointer was over the virtualized list region, making page scrolling feel broken.

## Changed Files

- `frontend/src/views/HomeView.vue`
  - Expanded the page-flow character list breakpoint from `760px` to `920px`, so narrow desktop and tablet-width browser panes use the normal document scroll instead of the fixed-height virtual scroll region.
- `frontend/src/styles.css`
  - Changed `.home-character-scroll` from `overscroll-behavior: contain` to `auto`, allowing wheel scrolling to chain back to the page when the virtual list reaches a scroll boundary.

## Validation

- `node scripts/check-encoding.mjs` - PASS
- `frontend`: `npm.cmd run build` - PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - FAIL
  - Encoding check PASS
  - Backend tests FAIL, 226/228 passing
  - Frontend build PASS

## Review Gate Failure

The full gate failed in existing backend status bar tests that are unrelated to this frontend scroll change:

- `status bar agent auto mode activates when variables or prompt exist and can update them`
  - Expected `75`, got `100`.
- `extractVariablesFromText finds HP and MP patterns`
  - `ReferenceError: normalizeVariableKey is not defined` in `backend/src/modules/statusBars.js`.

## Risk Notes

- The repository already had many unrelated uncommitted changes before this run. This run only intentionally changed the Home page list breakpoint, the Home virtual-scroll overscroll rule, and this report.
- `frontend/src/views/HomeView.vue` and `frontend/src/styles.css` already contained unrelated uncommitted changes, so review should focus on the specific breakpoint and overscroll edits.

## Next Recommended Task

Fix the existing backend status bar test failures so the full review gate can return to PASS.
