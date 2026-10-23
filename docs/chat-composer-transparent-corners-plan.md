# Chat Composer Transparent Corners Plan

## Objective

Remove the white backing visible outside the mobile chat composer's rounded
corners so the chat background shows through.

## Scope

- Inspect the composer, its wrapper, and the active mobile style cascade.
- Make a small CSS correction while preserving the input and toolbar layout.
- Review adjacent background rules for obsolete or conflicting declarations.
- Preserve all pre-existing user changes and avoid application data changes.

## Checklist

- [x] Inspect repository instructions and current Git status.
- [x] Identify which background layer paints the white corners.
- [x] Correct the responsible styles and review the focused diff.
- [x] Verify mobile light/dark appearance and desktop layout in the browser.
- [x] Run the frontend build and encoding check; record results.

## Acceptance Criteria

- The background outside the composer's rounded top corners is transparent.
- The composer retains its rounded surface and usable controls.
- Mobile and desktop composer sizing and placement remain intact.
- Frontend build and repository encoding checks pass.

## Validation Commands

- `npm run build` from `frontend`.
- `node scripts/check-encoding.mjs` from the repository root.
- Browser inspection at 370x747 and a desktop viewport, including light/dark
  themes and a chat background.

## Progress

- Initial inspection found existing work throughout the repository, including
  shared styles. Changes will be limited to the specific composer declarations.
- Confirmed in the browser at 370x747: the square wrapper painted an 86% white
  background and applied a second blur behind the rounded form.
- Removed the mobile wrapper background and blur declarations, restoring the
  base transparent wrapper while retaining the rounded form surface.
- Updated the existing CSS contract expectation that required the old backing.
- Browser verification passed at 370x747 in light and dark themes with the
  existing image background. The wrapper computes to transparent with no blur,
  retains its 14px form corners, and ends exactly at the viewport bottom.
- Desktop verification passed at 1440x900: composer and message scroller stay
  within the viewport and the message area ends at the composer boundary.
- `node --test src/tests/frontendChatComposer.test.js`: 17 passed.
- `npm test` from `backend`: 1603 passed, no failures or skips.
- `npm run build` from `frontend`: passed; existing bundle-size warning remains.
- `node scripts/check-encoding.mjs`: passed (682 files).
- Screenshot: `.runtime-check/ui-proof/chat-composer-corners-mobile.jpg`.
- No remaining work or blockers. Review gate was not run for this focused CSS
  correction; its applicable build, test, and encoding checks passed.
