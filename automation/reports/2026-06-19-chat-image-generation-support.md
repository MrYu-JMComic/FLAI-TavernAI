# 2026-06-19 Chat image and generation support

## Summary

Added chat image attachments and a chat image-generation mode. Users can attach PNG/JPEG/WebP images to chat messages, preview and remove pending images, view saved image attachments in message bubbles, and toggle image-generation mode to call compatible image generation models through the current provider configuration. Also fixed the dark-theme quick model dropdown so expanded options remain readable instead of showing pale text on a white native menu.

## Changed files

- `backend/src/db.js`
- `backend/src/modules/branches.js`
- `backend/src/modules/saves.js`
- `backend/src/routes/conversations.js`
- `backend/src/routes/helpers.js`
- `backend/src/services/providers.js`
- `backend/src/tests/conversationStreamingRoutes.test.js`
- `backend/src/tests/frontendChatComposer.test.js`
- `backend/src/validations/schemas.js`
- `frontend/src/components/chat/ChatComposer.vue`
- `frontend/src/components/chat/ChatMessageItem.vue`
- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/styles.css`
- `frontend/src/views/ChatView.vue`

## Validation

- Passed: `node --test src/tests/conversationStreamingRoutes.test.js`
- Passed: `node --test src/tests/conversationStreamingRoutes.test.js src/tests/providers.test.js`
- Passed: `node --test src/tests/frontendChatComposer.test.js src/tests/frontendChatMessageItem.test.js src/tests/frontendChatSubmit.test.js`
- Passed: `node --test src/tests/frontendChatComposer.test.js`
- Passed: `cd backend && npm test`
  - Result: 957 tests passed.
- Passed: `cd frontend && npm run build`
- Passed: `node scripts/check-encoding.mjs`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Notes

- Message attachments are stored in `messages.attachments_json` and preserved across conversation branches and save/load snapshots.
- Chat model requests use standard multimodal content blocks for OpenAI-compatible chat, OpenAI Responses, and Anthropic messages.
- Image generation uses OpenAI-compatible `/images/generations` with `response_format: "b64_json"` and saves the returned image as an assistant message attachment.
- Built-in compatibility checks allow OpenAI `gpt-image-2`, xAI `grok-imagine-image` and `grok-imagine-image-quality`, and custom OpenAI-compatible image models. `grok-imagine-image-lite` is rejected before any provider request because it is not supported on `/v1/images/generations` or `/v1/images/edits`.
- The quick model select now styles native option text/background explicitly for light and dark themes to avoid unreadable browser default dropdowns.
- Existing unrelated worktree changes were left intact.

## Next recommended task

Add provider UI hints for known image-generation models and expose image size/options for generation mode.
