# 2026-06-10 - Chat Recovery And World-Book Explainability

## Changed Files

- `backend/src/modules/worldBooks.js`
- `backend/src/routes/conversations.js`
- `backend/src/tests/conversationStreamingRoutes.test.js`
- `backend/src/tests/frontendChatComposer.test.js`
- `backend/src/tests/frontendChatSubmit.test.js`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `backend/src/tests/frontendHomeView.test.js`
- `backend/src/tests/frontendPresetView.test.js`
- `backend/src/tests/frontendSettingsView.test.js`
- `backend/src/tests/frontendWorldBookView.test.js`
- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/views/ChatView.vue`
- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/views/HomeView.vue`
- `frontend/src/views/PresetView.vue`
- `frontend/src/views/SettingsView.vue`
- `frontend/src/views/WorldBookView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-10-chat-recovery-worldbook-explainability.md`

## Summary

- Added chat failure recovery state with retry, restore-to-input, switch-model, settings, copy-error, and dismiss actions.
- Exposed latest world-book matches from backend conversation responses and stream metadata, then surfaced them in chat as an explainable trigger panel.
- Added a settings-page provider connection check that probes the selected provider and reports success, warning, or error states.
- Upgraded home, character, world-book, and preset loading error states with continuation actions so users can retry, create the missing item, clear blockers, check settings, or return home.
- Reconciled backlog status for completed backend coverage and recorded this iteration in Done.

## Coverage

- Added route coverage for streamed world-book match metadata.
- Added frontend source guards for chat recovery state, world-book explainability UI, provider probing, and continuation actions in error states.
- Updated existing home, character, preset, and world-book view tests around the new actionable error states.

## Validation

- PASS: `node --test backend/src/tests/frontendChatSubmit.test.js backend/src/tests/frontendChatComposer.test.js backend/src/tests/frontendSettingsView.test.js backend/src/tests/frontendWorldBookView.test.js backend/src/tests/frontendPresetView.test.js backend/src/tests/frontendHomeView.test.js backend/src/tests/frontendCharacterFormView.test.js backend/src/tests/conversationStreamingRoutes.test.js`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Add a small settings affordance that explains which provider/model will be used by chat before sending, especially after switching models from a failure recovery panel.
