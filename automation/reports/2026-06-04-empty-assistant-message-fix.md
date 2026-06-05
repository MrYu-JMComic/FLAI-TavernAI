# Empty Assistant Message Fix

## Summary

- Prevented empty assistant replies from being saved after model/provider streams return no content.
- Filtered historical empty assistant rows from conversation reads and recent prompt context.
- Added frontend cleanup for streamed assistant drafts when a completion finishes without usable content.
- Added a backend regression test covering empty streaming responses and stale empty assistant rows.

## Changed Files

- `backend/src/routes/conversations.js`
- `backend/src/tests/backend.test.js`
- `frontend/src/composables/chat/useChatSubmit.js`

## Validation

- `backend`: `node --test src/tests/backend.test.js` passed, 119 tests.
- `backend`: `npm.cmd test` passed, 207 tests.
- `frontend`: `npm.cmd run build` passed.

## Next Recommended Task

- Add a small user-facing retry affordance when the provider returns an empty response so the user can retry the last accepted message without retyping.
