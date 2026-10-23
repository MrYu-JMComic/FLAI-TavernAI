# Assistant Settings Layout Plan

## Objective

Make the character assistant's conversation settings easier to scan and use,
especially in the reported 368x768 mobile viewport.

## Scope

- Inspect the existing settings component, controls, and responsive styles.
- Organize conversation options, thinking strength, and editable scope into clear
  groups with consistent alignment and spacing.
- Preserve current settings behavior and existing user changes.
- Clean up only related obsolete or conflicting layout declarations.

## Checklist

- [x] Inspect repository instructions and current Git status.
- [x] Inspect the settings markup, style cascade, and mobile screenshot.
- [x] Refine the layout using existing components and design tokens.
- [x] Review the focused diff and verify mobile and desktop presentation.
- [x] Run the frontend build and encoding check; record results.

## Acceptance Criteria

- Settings have a clear hierarchy and aligned controls at 368x768.
- Scope options wrap consistently without horizontal overflow.
- Settings remain reachable in a bounded scroll area, and the message composer
  remains usable.
- Desktop layout remains coherent and all current controls retain behavior.
- Applicable frontend checks pass.

## Validation Commands

- `npm run build` from `frontend`.
- `node scripts/check-encoding.mjs` from the repository root.
- Existing focused component or integration checks where relevant.
- Browser visual inspection at mobile and desktop viewports.

## Progress

- This request arrived while the separate composer-corner fix was in progress.
- Updated `CharacterAiDraftInputs.vue` to group conversation options and edit
  scope, with a separate thinking-strength row and unchanged events/values.
- Updated `CharacterAiDraftPanel.vue` to keep its heading outside the scroll
  body, retaining the original height limit and composer position.
- Replaced the related loose flex layouts in `character-assistant.css` with
  aligned option rows, a responsive scope grid, and section spacing.
- Mobile visual verification passed at 368x768 in light and dark themes: two
  scope columns, no horizontal overflow, and the composer remains usable.
- Scrolling to the bottom reaches world-book settings while the header stays
  at the same position and the outer page does not scroll.
- Desktop verification passed at 1440x900 with five scope columns and no
  horizontal overflow; the settings panel stays above the composer.
- `npm run build` from `frontend`: passed; existing bundle-size warning remains.
- `npm test` from `backend`: 1603 passed, including existing frontend contracts.
- `node scripts/check-encoding.mjs`: passed (682 files).
- Screenshot: `.runtime-check/ui-proof/assistant-settings-mobile.jpg`.
- No remaining work or blockers. Review gate was not run for this focused
  presentation change; applicable build, test, and encoding checks passed.
