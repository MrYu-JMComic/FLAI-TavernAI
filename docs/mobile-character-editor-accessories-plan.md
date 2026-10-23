# Mobile Character Editor Accessories Plan

## Objective

Make accessory skill settings readable and correct the mobile character editor's fixed save bar position and excess bottom spacing, including the reported 411x684 viewport.

## Scope

- Correct the mobile-only layout for accessory skill rows whose current children are `.field.compact` controls.
- Make repeated skill groups and Agent settings actions easier to distinguish at phone widths.
- Position the fixed save bar according to whether the route shows the global bottom navigation.
- Match form tail spacing to the existing page-shell reserve so the final controls remain reachable without a large blank tail.
- Add a focused responsive browser check with screenshots in the ignored runtime output directory.
- Preserve existing desktop layout and the current accessory settings behavior.
- Review adjacent mobile form sizing for overflow without broad cleanup of shared settings styles.

## Checklist

- [x] Inspect Git status and current accessory component, mobile stylesheet, and related responsive rules.
- [x] Apply a one-column mobile grid to accessory rows and ensure each field can shrink to the available width.
- [x] Increase mobile spacing and visually distinguish Agent configuration actions from select controls.
- [x] Place the fixed save bar according to route navigation and reduce excess form tail padding.
- [x] Add a focused responsive browser check for accessory field separation, viewport overflow, and edit/create save bar placement.
- [x] Run the frontend build, focused browser check, and encoding check.
- [x] Inspect phone and desktop screenshots, including 411x684; record locations and findings.
- [x] Record validation results and remaining risks here.

## Acceptance Criteria

- Accessory field labels and controls appear in a clear vertical order on phone widths, with no side-by-side crowding or horizontal overflow.
- Existing agent configuration controls remain usable.
- Agent configuration actions are visually distinct from native select controls, and repeated skills are separated clearly.
- On character-edit routes without a global mobile navigation bar, the fixed save bar sits just above the safe area and the existing page-shell reserve keeps form controls clear.
- On character-create routes with a mobile navigation bar, the save bar remains above navigation and form controls can scroll clear of both bars.
- Desktop accessory rows retain their existing layout.

## Validation

- `npm run build` from `frontend`
- `npm run test:e2e -- e2e/character-accessory-layout.spec.js` from `frontend`
- Use a task-specific Playwright output directory to preserve other `.runtime-check` artifacts.
- `node scripts/check-encoding.mjs`
- `git diff --check`
- Dark-theme browser screenshots at 373x709, 411x684, 519x930, and 1280x900, inspected for spacing, clipping, overlap, and overflow. Save under `.runtime-check/mobile-character-accessory-test/`.

## Results

- Initial narrow-screen flex/grid mismatch corrected; layout now uses one full-width field per line.
- Skill row spacing and Agent action emphasis are implemented.
- On edit routes the save bar sits 8px above the safe-area bottom; on create routes under 620px it remains 70px above the bottom to clear the mobile navigation.
- Form tail padding is 0px for edit routes under 620px, 36px for create routes under 620px, and 40px for the mobile editor above 620px. This works with the page-shell bottom reserve already in place.
- `npm run test:e2e -- e2e/character-accessory-layout.spec.js --reporter=line` passed, covering phone field stacking and overflow, edit/create save-bar geometry, and desktop side-by-side controls.
- `npm run build` passed. Vite reported the existing warning for chunks larger than 500 kB.
- `node scripts/check-encoding.mjs` passed; `git diff --check` passed.
- Dark-theme screenshots were inspected at 373x709, 411x684, 519x930, and 1280x900, plus the 411x684 create page and accessory-section scroll end. Files are in `.runtime-check/mobile-character-accessory-test/footer-positioning/`.
- Visual checks found no horizontal overflow, clipped fields, or overlapping controls. The edit save bar no longer floats above a nonexistent navigation bar, and the accessory page ends with a small clearance above the save bar.
- No remaining task-specific risks identified.
