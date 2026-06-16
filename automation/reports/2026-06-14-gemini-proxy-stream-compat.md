# 2026-06-14 Gemini Proxy Stream Compatibility

## Changed
- Hardened OpenAI-compatible chat streaming in `backend/src/services/providers.js` so Gemini CLI / Antigravity-style reverse proxies can return:
  - normal JSON even when `stream: true` was requested,
  - JSON arrays of streamed chunks,
  - wrapped chunk payloads under `data`, `payload`, `chunk`, `result`, or `response`,
  - Gemini native `candidates[].content.parts[]`,
  - object deltas such as `{ "delta": { "text": "..." } }`,
  - Responses-style `content_part` and `output_item` text events.
- Reused the same tolerant payload extraction in `streamToolCompletion()` so character/world-book/NPC assistant tool flows do not go empty when a Gemini proxy ignores SSE mode or returns Gemini native tool calls.
- Converted Gemini native `functionCall` parts into the existing OpenAI-compatible `tool_calls` shape.
- Kept provider diagnostics for empty assistant responses so future gateway-specific shapes can be identified without logging prompts, replies, or API keys.

## Validation
- `node --test src/tests/providers.test.js`
- `node --test src/tests/providers.test.js src/tests/backend.test.js`
- `node scripts/check-encoding.mjs`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/health -TimeoutSec 3`

All validation passed. The backend health check returned `{"ok":true,"service":"flai-tavern-backend"}`.

## Notes
- The pasted Vite `ECONNREFUSED 127.0.0.1:3001` logs mean the frontend proxy could not reach a running backend at that moment. During this run, port 3001 was listening and `/api/health` was healthy.
- Use `powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1` to start both the backend and frontend together; running only the frontend dev server will reproduce the proxy refusal whenever the backend is down.

## Next Recommended Task
- If Gemini still returns an empty assistant response, use the existing backend diagnostic id from the chat recovery panel to inspect the safe `providerDiagnostics` shape and add a focused parser fixture for that exact gateway event.
