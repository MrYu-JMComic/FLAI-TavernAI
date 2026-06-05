# Status Bar Template Guard

## Summary

- Tightened character assistant guidance for generated status bar templates.
- Added frontend validation for custom status bar templates before saving.
- Displayed template validation issues in the chat settings drawer.
- Hardened status bar custom CSS value filtering.

## Changed Files

- `backend/src/services/characterAssistant.js`
- `frontend/src/components/StatusBar.vue`
- `frontend/src/components/chat/ChatSettingsDrawer.vue`
- `frontend/src/composables/chat/useChatAccessory.js`
- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/views/ChatView.vue`
- `frontend/src/styles.css`

## Validation

- `frontend`: `npm.cmd run build` passed.
- `backend`: `npm.cmd test` passed, 206 tests.
- `root`: `node scripts/check-encoding.mjs` passed.

## Next Recommended Task

- Reuse the same template validator in the character form initial status bar editor so manually authored character blueprints get the same immediate feedback.
