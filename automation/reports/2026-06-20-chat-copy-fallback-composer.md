# Chat Copy Fallback Composer

## Summary

- Added a chat message copy fallback that inserts the message text into the composer when clipboard access is denied or unavailable.
- Wired `ChatView` to append fallback text to the current composer draft and focus the input.
- Added coverage for denied clipboard permission and the `ChatView` fallback wiring.

## Changed Files

- `frontend/src/composables/chat/useChatMessageActions.js`
- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatMessageActions.test.js`
- `backend/src/tests/frontendChatMessageItem.test.js`

## Validation

- `node --test src/tests/frontendChatMessageActions.test.js src/tests/frontendChatMessageItem.test.js` in `backend`: passed.
- `node scripts/check-encoding.mjs`: passed.
- `npm test` in `backend`: passed.
- `npm run build` in `frontend`: passed.

## Notes

- The worktree already contained unrelated modified files before this change, including existing edits in `frontend/src/views/ChatView.vue` and `backend/src/tests/frontendChatMessageItem.test.js`; those edits were preserved.
- No generated build output was committed or edited manually.

## Next Recommended Task

- Consider applying the same composer fallback pattern to other optional copy buttons, such as failure diagnostics or status-bar template copy actions, if the intended user flow is also "put it in the chat input when clipboard is unavailable."
