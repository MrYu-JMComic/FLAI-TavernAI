# Chat Composer Auto Image Generation

## Summary

- Removed the chat composer shortcut toolbar UI path and its source-test expectations so the mobile composer no longer spends vertical space on Bold/Italic/{user}/history controls.
- Removed the manual chat image-generation toggle from `ChatComposer`, `ChatView`, and `useChatSubmit`.
- Changed chat image generation to be derived from the current provider model. Known image models automatically send non-streaming `imageGeneration: true`; regular chat models keep the existing streaming behavior.
- Added backend auto-detection for image-generation models before the chat/stream branch, while preserving the explicit API flag for callers that still use it.

## Changed Files

- `frontend/src/components/chat/ChatComposer.vue`
- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/views/ChatView.vue`
- `frontend/src/styles.css`
- `backend/src/services/providers.js`
- `backend/src/routes/conversations.js`
- `backend/src/tests/frontendChatComposer.test.js`
- `backend/src/tests/frontendChatSubmit.test.js`
- `backend/src/tests/conversationStreamingRoutes.test.js`

## Validation

- `node --test src/tests/frontendChatComposer.test.js src/tests/frontendChatSubmit.test.js src/tests/conversationStreamingRoutes.test.js` in `backend`: passed.
- `npm run build` in `frontend`: passed.
- `node scripts/check-encoding.mjs`: passed.
- `npm test` in `backend`: passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS.

## Notes

- The worktree already contained unrelated parallel changes in files such as `AGENTS.md`, `SettingsView.vue`, `MarkdownContent.vue`, and other frontend tests. This iteration only worked within the chat composer/image-generation path and did not revert those changes.
- Custom providers still support explicit `imageGeneration: true` API calls, but automatic UI triggering is conservative and only turns on for known image model names to avoid breaking ordinary custom chat gateways.
