# DeepSeek Search Mode Plan

## Objective

Add DeepSeek online search to chat using Search and Fetch APIs, group response modes for narrow screens, make the composer toolbar resemble the supplied compact control row, and match image-upload availability to Flash and Pro model support.

## Scope

- Add a persistent chat UI toggle available only when the selected provider is DeepSeek, grouped with streaming in a compact composer popover.
- Keep the composer and control behavior unchanged while styling only the toolbar row to match the supplied reference: model dropdown, thinking level, image icon, slider popover, and send/stop action.
- Remove visible frames from the image and slider icon controls; keep model and thinking controls compact and legible on narrow screens.
- Pass the mode through send, continue, and regenerate requests without changing the global provider profile.
- When enabled, use DeepSeek Search and Fetch server-side and provide bounded source content to the model.
- Enable image attachments for DeepSeek Flash models and keep them disabled for DeepSeek Pro.
- Keep the mode off by default and avoid search calls when it is off.
- Add focused tests and update relevant documentation.

## Checklist

- [x] Trace request options and confirm DeepSeek Search/Fetch protocol details against the official guide.
- [x] Add request validation and server-side online-search orchestration.
- [x] Add a DeepSeek-only chat toggle with persisted local preference.
- [x] Move streaming and DeepSeek online search into one compact response-mode popover with a standalone slider icon in the composer.
- [x] Match the supplied compact toolbar UI while retaining each chat control's existing behavior.
- [x] Make DeepSeek image capability model-aware so Flash accepts images while Pro remains text-only; retain old model IDs only as compatibility aliases.
- [x] Add focused backend and frontend tests; inspect related legacy paths.
- [x] Run backend tests, frontend unit tests, frontend build, encoding check, and diff checks.
- [x] Capture and inspect desktop and mobile screenshots of the changed chat UI.
- [x] Run the repository review gate and record its result.
- [x] Record validation, screenshot locations, and remaining risks here.

## Acceptance Criteria

- A standalone slider icon opens independent streaming and online-search controls; online search is shown only for DeepSeek and remains independent of thinking settings.
- The toolbar visually follows the requested order: model dropdown, thinking level, image, slider popover, and send/stop; only the toolbar UI changes, while the textarea and actions retain their existing behavior.
- DeepSeek Flash models expose image attachments, while DeepSeek Pro does not.
- With the mode off, DeepSeek requests do not call Search or Fetch.
- With the mode on, current user text can trigger DeepSeek Search and fetched page content is bounded before being added to model context.
- Existing send, continue, and regenerate behavior remains intact for other providers.
- Search and Fetch cost disclosure reflects DeepSeek's published price and effective date.
- Tests and required project checks pass, and desktop/mobile screenshots are visually inspected.

## Validation

- `npm test` from `backend`: passed, 1670 tests.
- `npm run test:unit` from `frontend`: passed, 323 tests.
- `npm run build` from `frontend`: passed; Vite reported the existing large-chunk advisory.
- `npm run test:e2e -- e2e/deepseek-online-search.spec.js` from `frontend`: passed after the final toolbar order and send-icon centering changes at 1440x900, 390x844, 363x668, and 320x700. Checks include toolbar order, narrow-screen overflow, popover bounds, and send SVG/button center alignment within 1px.
- `node scripts/check-encoding.mjs`: passed, 716 files scanned.
- `git diff --check`: passed; Git printed line-ending conversion notices for existing working-tree files.
- Composer unit test after the final toolbar update: passed, 2 tests. The full frontend unit suite passed 323 tests in the review gate.
- Repository review gate: backend tests, frontend build, frontend unit tests, and all 97 E2E tests passed. The gate returned failure only for the frontend production dependency audit, which reported high advisories in `markdown-it` and `vite`; the audit-free backend dependency check passed.
- Screenshot review: `.runtime-check/deepseek-online-search-desktop.png` at 1440x900 and `.runtime-check/deepseek-online-search-mobile.png` at 363x668. Both were visually inspected after the final changes; the order is model, thinking, image, slider, send, and the icon controls have no visible frame. Automated checks also passed at 390px and 320px.

## Remaining Risks

- Old DeepSeek model IDs remain accepted as aliases so existing provider profiles keep working; generated requests use `deepseek-flash`.
- The repository review gate remains red because the current frontend dependency tree includes vulnerable `markdown-it` and `vite` versions; dependency upgrades are outside this task's scope.
