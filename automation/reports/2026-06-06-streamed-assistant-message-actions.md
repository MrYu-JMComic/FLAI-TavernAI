# Streamed Assistant Message Actions

## Summary

- Fixed streamed assistant replies that could remain as local draft messages after generation completed.
- Added SSE tail handling so a final event is still processed if the stream closes without a trailing blank separator.
- Added a post-stream reconciliation pass that replaces local user/assistant drafts with persisted messages from the conversation API when needed.

## Changed Files

- `frontend/src/api.js`
- `frontend/src/composables/chat/useChatSubmit.js`

## Validation

- `node scripts/check-encoding.mjs` passed.
- `npm.cmd run build` in `frontend` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed.

## Notes

- The worktree already contained many unrelated modified and untracked files before this change; they were preserved.
- If the backend does not persist an assistant reply because the processed output is empty, the reconciliation intentionally does not attach the visible draft to an older assistant message.
