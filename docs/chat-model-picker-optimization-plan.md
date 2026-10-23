# Chat Model Picker Optimization Plan

## Objective

Optimize the chat page model selection dialog to match the refined model picker used by the AI assistant page.

## Scope

- Align chat picker structure, provider context, search, refresh, loading, empty, and selection states with the assistant picker.
- Add a provider-profile bar to the chat picker so users can switch the active global gateway without leaving chat.
- Preserve chat-specific save behavior and current model switching flow.
- Make the composer model control always open the picker, including when the model catalog is already loaded; remove the legacy native model dropdown.
- Keep responsive and accessibility behavior intact.

## Checklist

- [x] Inspect current chat and assistant picker implementations and styles.
- [x] Update chat picker component and styles with the shared interaction pattern.
- [x] Review related legacy styles and remove obsolete overlay and bottom-sheet rules.
- [x] Add end-to-end checks for search, focus handling, selected-state semantics, short viewports, and explicit save.
- [x] Route the populated-catalog composer model control through the picker and remove legacy native-select/direct-change logic.
- [x] Extend end-to-end coverage to verify the main composer control opens the picker when models are already available.
- [x] Add global gateway profiles to the chat picker and connect profile selection to the active provider API.
- [x] Load the chosen gateway's model catalog and guard refresh/save responses against gateway changes.
- [x] Extend the end-to-end check to switch gateways and save a model on the newly active gateway.
- [x] Run the end-to-end check, frontend build, backend static test, encoding validation, and diff checks after the follow-up changes.

## Acceptance Criteria

- Chat model dialog has the assistant picker visual hierarchy and interaction quality.
- The composer has no native model dropdown; its visible model control always opens the dialog.
- Search, refresh, loading/error/empty states and model selection remain functional.
- Chat can switch the globally active provider profile from the picker and model selection saves to that active profile.
- Existing explicit chat model save behavior is preserved.
- Frontend build and encoding checks pass.

## Validation

- `npm run build` from `frontend`
- `npm run test:e2e -- e2e/chat-model-switcher.spec.js` from `frontend`
- `node scripts/check-encoding.mjs`

## Results

- The initial end-to-end check covered model search, short viewport scrolling, Escape close and focus restore, selected-state semantics, and explicit save.
- Initial frontend build and encoding validation passed before the populated-catalog follow-up.
- Follow-up review found stale native-select styles and tests, and mobile CSS hid the model label. Those paths are removed and the populated-catalog case is now covered; rerun validation before completion.
- Follow-up request clarified that the chat picker must also switch global provider profiles, as the assistant picker allows choosing its provider context.
- The chat picker now lists saved global gateway profiles, highlights the active profile, switches the active profile, and loads that profile's catalog before enabling model selection.
- End-to-end validation switched to a second gateway and confirmed that the explicit model save payload used the newly active provider.
- The model dialog now chooses focus from the live viewport, so resizing between mobile and desktop openings does not preserve a stale focus target.
- Validation passed: `npm run test:e2e -- e2e/chat-model-switcher.spec.js`, `npm run build`, `npm test` in `backend`, `node scripts/check-encoding.mjs`, and targeted `git diff --check`.
- The production build continues to report the existing large-chunk advisory.
