# 2026-06-25 Workspace Desktop Width, Scroll, And Sticky Navigation

## Summary

Expanded the desktop width and single-scroll fix from Home to the other workspace pages: create/edit character, presets, world books, extensions, and personal center. Also fixed the workspace section navigation so character and settings/extension section tabs stick directly below the top app bar when the page shell is the scroll container.

## Changed Files

- `frontend/src/components/BaseLayout.vue`
  - Added `workspace-layout-shell` for create/edit character, presets, world books, extensions, and settings routes.
- `frontend/src/styles.css`
  - Let Home and workspace routes fill the available desktop width instead of keeping the global page width cap.
  - Made workspace routes use the page shell as the single vertical scroll container.
  - Removed the nested Home character-list scroller so wheel/trackpad scrolling stays on the page shell.
  - Set workspace character and settings section navigation to `top: 0` inside the page shell, fixing the extra sticky offset shown in the screenshot.
- `frontend/src/views/HomeView.vue`
  - Bound the Home virtualizer to the page-shell scroll container and remeasured after content height changes.
- `frontend/src/views/CharacterFormView.vue`
  - Moved section-nav scroll listeners and section jumps from `window` to the page-shell scroll container.
- `frontend/src/views/SettingsView.vue`
  - Moved personal center and extension section jumps from `scrollIntoView()` to page-shell-aware scrolling.
- `frontend/src/views/PresetView.vue`
  - Marked the page as `preset-page` and removed the local `640px` edit-form width cap.
- `backend/src/tests/frontendBaseLayout.test.js`
  - Added regression coverage for workspace width, single-scroll shell, and sticky section navigation top offset.
- `backend/src/tests/frontendHomeView.test.js`
  - Added regression coverage for Home desktop width, single-scroll behavior, and virtualizer remeasurement.
- `backend/src/tests/frontendCharacterFormView.test.js`
  - Added regression coverage for page-shell-based character section scrolling.
- `backend/src/tests/frontendSettingsView.test.js`
  - Added regression coverage for page-shell-based personal/extension section scrolling.
- `backend/src/tests/frontendPresetView.test.js`
  - Added regression coverage for expanded preset page/editor width.

## Validation

- `cd backend; node --test src/tests/frontendBaseLayout.test.js src/tests/frontendCharacterFormView.test.js src/tests/frontendSettingsView.test.js src/tests/frontendHomeView.test.js` - pass, 71/71.
- `cd backend; npm test` - pass, 988/988.
- `cd frontend; npm run build` - pass.
- `node scripts/check-encoding.mjs` - pass, scanned 711 files.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - pass after adding the local Git path for the gate environment.

## Notes

- No protected data, upload, environment, dependency, or generated output files were edited.
- No merge, push, deploy, or external PR action was taken.

## Next Recommended Task

Do a quick visual smoke test on a wide desktop viewport by scrolling Home, character edit, personal center, and extensions to confirm the top app bar and section tabs stay flush while page content scrolls.
