# World Book Assistant SSE Proxy Fix

## Summary

- Fixed long-running assistant SSE requests so dev proxy connections are less likely to reset while `/api/world-books/complete-draft` is generating.
- Backend compression now skips requests/responses that use `text/event-stream`, allowing SSE heartbeats and error events to flush promptly.
- Vite dev/preview proxy now uses an explicit 10 minute API/upload timeout, configurable via `VITE_API_PROXY_TIMEOUT_MS` or `API_PROXY_TIMEOUT_MS`.
- World book assistant streaming now explicitly disables socket timeouts for the SSE response and marks the response as `Content-Encoding: identity`.
- Frontend assistant streams now send `Accept: text/event-stream` so the backend and proxies can classify the request as SSE from the start.

## Changed Files

- `backend/src/server.js`
- `backend/src/routes/worldBooks.js`
- `frontend/src/api.js`
- `frontend/vite.config.js`

## Validation

- `node scripts/check-encoding.mjs` - passed
- `cd backend && npm test` - passed, 361 tests
- `cd frontend && npm run build` - passed

## Notes

- The working tree already contained many unrelated modified and untracked files before this run. This change only targeted the connection layer for assistant/SSE requests.
- Existing world book assistant generation logic was left unchanged.

## Next Recommended Task

- Add a route-level regression test for `/api/world-books/complete-draft` streaming error handling, ideally with a mocked provider stream that stalls or resets mid-response.
