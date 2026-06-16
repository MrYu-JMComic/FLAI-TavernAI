# 2026-06-11 - World-Book Match Source Toggle

## Changed Files

- `backend/src/modules/advancedSettings.js`
- `backend/src/modules/conversationAppearance.js`
- `backend/src/validations/schemas.js`
- `backend/src/tests/backend.test.js`
- `backend/src/tests/frontendChatAppearance.test.js`
- `backend/src/tests/frontendChatComposer.test.js`
- `backend/src/tests/frontendChatSettingsDrawer.test.js`
- `frontend/src/components/chat/ChatSettingsDrawer.vue`
- `frontend/src/composables/chat/useChatAppearance.js`
- `frontend/src/styles.css`
- `frontend/src/utils/chatAppearance.js`
- `frontend/src/views/ChatView.vue`
- `automation/reports/2026-06-11-worldbook-match-source-toggle.md`

## Summary

- Added a persisted `showWorldBookMatches` advanced setting with a default of `true`.
- Exposed the setting as a high-settings toggle in the chat world-book section.
- Gated the world-book match source details panel behind the setting.
- Fixed the collapsed details panel body so the match list is hidden until the panel is opened.

## Validation

- PASS: `node --test src/tests/frontendChatComposer.test.js src/tests/frontendChatSettingsDrawer.test.js src/tests/frontendChatAppearance.test.js` in `backend`.
- PASS: `node --test src/tests/backend.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm run build` in `frontend`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Notes

- The working tree already contained unrelated modified and untracked files before this run; they were preserved.

## Next Recommended Task

- Verify the panel visually in the running browser after toggling the setting off and on for an active conversation.
