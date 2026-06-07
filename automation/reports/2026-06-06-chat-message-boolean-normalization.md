# Chat Message Boolean Normalization

## Summary

- Added a strict boolean-like schema helper for chat message request flags.
- Allowed `stream` and `thinkingEnabled` to accept explicit string boolean values (`"true"`, `"false"`, `"1"`, `"0"`) while leaving unknown strings invalid.
- Added an end-to-end route regression test proving `"stream":"false"` uses the non-streaming path and `"thinkingEnabled":"false"` disables DeepSeek thinking.

## Changed Files

- `backend/src/validations/schemas.js`
- `backend/src/tests/backend.test.js`

## Validation

- `node --check src\validations\schemas.js` - passed
- `node --test --test-name-pattern "chat message route normalizes string boolean request flags|chat prompt history|streaming chat" src\tests\backend.test.js` - passed, 3 tests
- `npm.cmd test` in `backend` - passed, 351 tests
- `npm.cmd run build` in `frontend` - passed

## Notes

- Additional unrelated worktree changes appeared during the run; they were left untouched.

## Next Recommended Task

- Continue coercion review with the economy query helpers, especially numeric pagination defaults and `ensureDefaultAccount` handling.
