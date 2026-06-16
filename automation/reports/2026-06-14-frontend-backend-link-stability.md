# 2026-06-14 Frontend Backend Link Stability

## Changed
- Added short retry handling for idempotent frontend API requests in `frontend/src/api.js`.
  - Retries only `GET` and `HEAD` requests.
  - Covers transient connection failures and HTTP `408`, `502`, `503`, and `504`.
  - Keeps mutations such as `POST`, `PUT`, `PATCH`, and `DELETE` single-attempt to avoid duplicate writes or duplicate chat messages.
- Made the Vite dev/preview proxy in `frontend/vite.config.js` return a clear `503` response when the backend is unavailable, so the frontend retry path can handle short backend restarts more gracefully.
- Added main chat SSE keepalive handling in `backend/src/routes/conversations.js`.
  - Disables socket idle timeouts for the chat stream.
  - Sends periodic `ping` SSE events while the provider is quiet.
  - Uses identity encoding for the stream to avoid compression buffering.
- Added focused regression coverage in:
  - `backend/src/tests/frontendApi.test.js`
  - `backend/src/tests/conversationStreamingRoutes.test.js`

## Validation
- `node --test src/tests/frontendApi.test.js src/tests/conversationStreamingRoutes.test.js`
- `npm run build` in `frontend`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/health -TimeoutSec 3`

All validation passed. The backend health check returned `{"ok":true,"service":"flai-tavern-backend"}`.

## Notes
- This does not retry chat send requests automatically because a retry after an uncertain disconnect could create duplicate user messages.
- For backend-down windows, read-only UI loads now get a brief chance to recover instead of failing immediately.

## Next Recommended Task
- Add a small visible connection status indicator in the shell layout if users still need clearer feedback during backend restarts.
