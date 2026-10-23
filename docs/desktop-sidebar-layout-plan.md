# Desktop Sidebar Layout Plan

## Objective

Optimize the desktop interface using the supplied Codex layout reference: remove
the global top navigation bar, consolidate navigation in a left sidebar, and
give the active workspace the full available height.

## Scope

- Review the existing application shell, navigation, responsive styles, and tests.
- Preserve existing uncommitted work and integrate with the current layout.
- Refine desktop navigation and content framing using existing components.
- Preserve access to navigation, settings, theme controls, and mobile layouts.
- Clean up obsolete desktop top-bar markup, styles, and related expectations.

## Checklist

- [x] Inspect the current layout and identify affected desktop/mobile behavior.
- [x] Implement the desktop sidebar and remove the desktop global top bar.
- [x] Update affected layout checks and remove obsolete related logic/styles.
- [x] Build the frontend and run relevant layout checks and encoding validation.
- [x] Verify desktop and mobile rendering where local tooling permits.
- [x] Record validation results, remaining risks, and completion status.

## Acceptance Criteria

- Desktop navigation is presented on the left, with no global top navigation bar.
- The active content uses the full height and resembles the reference's clear
  separation between navigation and workspace.
- Existing routes, sidebar collapse, settings, and theme controls remain usable.
- Mobile navigation and narrow-screen content remain usable.
- Existing unrelated edits are preserved.
- The full character form remains vertically stacked and usable with expanded
  desktop navigation, including at widths of 901px, 1180px, and 1280px.
- Applicable build, layout checks, and encoding validation pass.

## Validation Commands

- `npm run build` from `frontend`.
- `npm test` from `backend`.
- `npx playwright test e2e/home-library-ui.spec.js e2e/character-workbench.spec.js
  e2e/chat-composer-viewport.spec.js e2e/character-ai-panel-drag.spec.js --workers=1`
  from `frontend`.
- `node scripts/check-encoding.mjs` from the repository root.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` if scope
  expands into broad changes.

## Results

- Initial Git inspection found substantial existing work, including edits to the
  base layout, responsive styles, workspace styles, and layout tests. Changes in
  this task will be limited to the desktop shell and necessary compatibility.
- Desktop uses one left navigation rail and a rounded full-height workspace.
  Navigation collapses from 224px to 72px and defaults to compact on desktop
  widths up to 1180px. Account/theme controls sit at the bottom; menus open upward.
- Existing top-bar styling remains in use only at widths up to 900px. Chat keeps
  its own navigation; the mobile assistant retains its existing full-screen mode.
- Frontend production build passed, including its encoding precheck. Vite reports
  the existing advisory about a bundle chunk exceeding 500 kB.
- Targeted BaseLayout contract tests passed (6/6); the full backend and frontend
  contract suite also passed (1586/1586).
- Browser checks passed (21/21) across the home library, sidebar collapse,
  account/settings navigation, light/dark themes, character editor, assistant,
  and chat composer resizing. Initial obsolete mobile-menu and border-inset test
  expectations were corrected before the successful final run.
- Visual QA covered desktop and mobile home layouts, assistant, presets, and
  settings. It also covered expanded-sidebar character editing at 901px, 1024px,
  and 1180px, plus default layouts at 1280px and 1440px. No editable controls
  extend outside the workspace and no page JavaScript errors were observed.
- The editor review exposed an old grid-row rule affecting nested full-form
  sections. The rule now targets only the outer stage, and narrow desktop
  summaries stack vertically. A browser regression check covers this behavior.
- Final frontend build passed after all source changes. Encoding and whitespace
  checks passed. The change remains scoped to the layout; no review-gate run was
  needed. No outstanding blockers or required follow-up work remain.

## Changed Files

- `frontend/src/components/BaseLayout.vue`: shared navigation, collapse controls,
  compact defaults, and accessible labels.
- `frontend/src/styles/app-shell.css`: desktop sidebar/workspace styling and
  removal of obsolete desktop top-bar grid declarations.
- `frontend/src/styles/character-editor.css`: full-form and summary compatibility.
- `backend/src/tests/frontendBaseLayout.test.js`: sidebar shell expectation.
- `frontend/e2e/home-library-ui.spec.js`: desktop/mobile navigation regressions
  and content-relative responsive assertions.
- `frontend/e2e/character-workbench.spec.js`: expanded-sidebar full-form regression.
- This plan: task scope, checklist, acceptance criteria, and validation results.
