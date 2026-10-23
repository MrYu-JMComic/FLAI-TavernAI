# Mobile Chrome Viewport Recovery Plan

## Objective

Prevent the mobile Chrome assistant page from remaining shifted upward with its header offscreen after keyboard, browser restoration, or viewport changes.

## Scope

- Trace the assistant viewport sizing, outer shell scrolling, focus, and browser restoration paths.
- Reproduce the incorrect outer-page offset without changing saved user data.
- Fix the responsible layout or lifecycle path and remove directly superseded viewport logic.
- Keep ordinary pages scrollable and preserve assistant transcript position, keyboard usability, and desktop layout.

## Checklist

- [x] Inspect and reproduce the viewport/scroll failure with evidence.
- [x] Implement a scoped correction and meaningful regression coverage.
- [x] Verify keyboard open/close, stale outer scroll, restoration, and mobile/desktop layout.
- [x] Run focused tests, frontend build, encoding check, and touched-path diff check.
- [x] Record findings, results, and device-specific limitations.

## Acceptance Criteria

- The assistant header remains inside the visible viewport when the keyboard is closed.
- The composer remains usable while the visual viewport shrinks or pans for the keyboard.
- Reload/back-forward or tab restoration recovers layout without clearing browser data.
- Transcript scroll and unrelated page scrolling are preserved.
- Relevant checks pass and existing unrelated work is preserved.

## Validation Commands

- Focused Playwright viewport and assistant tests, selected after diagnosis.
- Relevant frontend unit tests for viewport helpers if behavior changes there.
- `npm run build` in `frontend`.
- `node scripts/check-encoding.mjs` at the repository root.
- `git diff --check` for touched tracked paths.
- Backend tests only if backend code changes; broad review gate only if scope becomes broad.

## Results

- User screenshots show a missing top header and a bottom gap on Android Chrome; clearing browser data restores the header.
- Initial repository inspection completed. Existing source changes and saved data must be preserved.
- Isolated Chromium reproduction before the fix: restoring a 64px outer document offset leaves the assistant header at -64px and an equal bottom gap. This explicitly models Android Chrome's large/dynamic viewport difference; desktop emulation does not implement the browser toolbar itself.
- Repeated visual viewport events with unchanged draft/layout caused 32 textarea style mutations, unnecessarily collapsing the focused input while Chrome may be panning for the keyboard.
- The correction uses dynamic root minimum heights, a viewport-anchored mobile assistant, non-scrollable assistant outer clipping, stable composer measurement, and guarded restoration after layout. Normal page and transcript scrolling remain independent.
- Implemented the scoped correction. Removed the mobile relative-positioning path and unconditional composer resizing on viewport events; programmatic composer focus now prevents outer scrolling. Restoration skips keyboard panning and pinch zoom, and pending callbacks are cancelled on unmount.
- Initial viewport regressions: 3 passed. Includes keyboard transitions, unchanged-layout event bursts with zero textarea style mutations, a restored 64px root offset, pinch zoom, preserved transcript/caret, and desktop/ordinary-page scrolling.
- Frontend build passed (existing bundle-size advisory remains). Existing layout and character form source contracts: 37 passed.
- Combined Playwright run: 30 passed. Covered the new viewport regressions, ordinary chat composer, assistant images/status preview/avatar saving, character workbench, and home library in desktop/mobile and light/dark modes.
- Background visibility restoration and persisted pageshow both recover the injected outer scroll without moving the transcript. A simulated keyboard-close transition with restored height but still-panned offset does not scroll the outer shell.
- Changed source: `CharacterAssistantView.vue`, `character-assistant.css`, `workspace.css`, `layout.css`, and `app-shell.css`. Added `frontend/e2e/character-assistant-viewport.spec.js`. No backend implementation or saved-data changes were needed.
- Visual result inspected: `.runtime-check/assistant-mobile-restored.png`; header at 0px, composer bottom at 844px in the 390x844 test viewport, with no bottom gap.
- Remaining limitation: no physical Android Chrome device is connected. The regressions simulate viewport geometry and lifecycle events; native address-bar/keyboard event timing still needs device confirmation. Clearing browser data is not part of the correction.
- Final encoding check passed (663 files); touched tracked paths passed `git diff --check`. No implementation work remains for the reproduced failure.
