# Chat Interrupted Stream Persist

## Summary

- Captured streamed assistant `content` and `reasoning` on the backend while sending SSE chunks.
- When the client aborts a stream after visible output has arrived, the backend now saves the partial assistant message instead of dropping it.
- After the user stops generation, the frontend now retries conversation-message reconciliation so local streamed drafts receive persisted message ids and can be edited or deleted.

## Changed Files

- `backend/src/routes/conversations.js`
- `frontend/src/composables/chat/useChatSubmit.js`
- `backend/src/tests/conversationStreamingRoutes.test.js`
- `backend/src/tests/frontendChatSubmit.test.js`

## Validation

- PASS: `node --test backend\src\tests\conversationStreamingRoutes.test.js backend\src\tests\frontendChatSubmit.test.js`
- PASS: `npm run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`

## Next Recommended Task

- Manually interrupt a streaming reply in the chat UI, then verify the partial assistant message can be deleted and edited without refreshing.
