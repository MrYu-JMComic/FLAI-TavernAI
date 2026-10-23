# Page Heading Cleanup Plan

## Objective

Remove the large top-of-page eyebrow and title blocks that consume space across workspace pages, including Personal Center, Extension Management, and the main library/editor/workbook/admin pages. Reposition the Personal Center detail back action so it remains easy to find without rebuilding a large heading row.

## Scope

- Remove visual eyebrow and title text from the Personal Center overview and detail routes, and from Extension Management.
- Remove or visually hide redundant top-level page titles on the main library, character editor, world book overview/detail, and admin views.
- Preserve refresh, import/export, create, preview, AI assistant, and return controls currently placed beside or inside page headings.
- Keep a screen-reader page title where removing the visual title would otherwise remove the page's primary heading.
- Keep the Extension Management section navigation and all page content.
- Move the Personal Center detail return action to a compact, left-aligned position above the detail content.
- Stack the Personal Center profile fields at mobile widths where a two-column form causes overlap.
- Retain contextual headers on authentication, chat, and the character assistant workspace.
- Add focused regression coverage for removed titles, preserved controls, and detail-page back placement.

## Checklist

- [x] Remove the Personal Center and Extension Management title blocks while preserving their route controls and section navigation.
- [x] Compact the Personal Center detail return action and align it with the page content.
- [x] Remove redundant visual page titles from the main library, character editor, world book, and admin views while preserving actions and accessible page names.
- [x] Update responsive/layout styles for the reduced heading structures.
- [x] Add or update focused tests for the affected workspace views, return action, and mobile profile field layout.
- [x] Run frontend build, focused tests, encoding check, and diff checks.
- [x] Capture and inspect affected desktop and mobile pages; record screenshot paths and results.

## Acceptance Criteria

- The Personal Center, its detail routes, and Extension Management no longer show the selected eyebrow/title block.
- Other workspace pages no longer reserve a large top row for a redundant page title.
- Every existing heading-row action remains available and usable at desktop and mobile sizes.
- Settings detail pages retain a visible, compact back-to-Personal-Center control aligned at the content's left edge.
- Screen-reader users retain page-title context where needed; authentication, chat, and assistant workspace context remains intact.
- No horizontal overflow, clipping, or overlap appears in the affected viewports.

## Validation Commands

- `npm run build` from `frontend`
- `node --test src/tests/frontendSettingsView.test.js src/tests/frontendBaseLayout.test.js` from `backend`
- Run affected frontend unit tests and the focused Playwright page-heading regression flow.
- `node scripts/check-encoding.mjs` from the repository root
- `git diff --check`
- Inspect desktop and mobile screenshots for Personal Center, Extension Management, library, character editor, world book, and admin views.

## Validation Results

- `npm run build` passed; Vite emitted its existing large-chunk advisory for the KaTeX math bundle.
- `node --test src/tests/frontendSettingsView.test.js src/tests/frontendBaseLayout.test.js` passed: 26 tests.
- Focused Playwright run passed: 12 tests across page-heading cleanup, Personal Center, Character Workbench, Character AI panel drag, and local-first smoke specs.
- `node scripts/check-encoding.mjs` passed across 725 files.
- `git diff --check` passed.
- Desktop screenshots (1440x900, or 1280x900 for the Character Editor) and mobile screenshots (519x930) were captured under `.runtime-check/playwright-results/page-heading-cleanup-remov-d1001-tions-and-return-navigation-chromium/` and inspected. Personal Center route screenshots at 1440x900, 519x930, and 320x844, including detail pages, were captured under `.runtime-check/playwright-results/personal-center-Personal-C-3e972-t-desktop-and-mobile-widths-chromium/`.
- Visual review confirmed removed title bands, preserved page actions and extension sections, left-aligned return buttons, no horizontal overflow, and stacked profile fields at 519px. Mobile detail routes omit the bottom navigation. The Character Editor retains its compact fixed save action bar.
