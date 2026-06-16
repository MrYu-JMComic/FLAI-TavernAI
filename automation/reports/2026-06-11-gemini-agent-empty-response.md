# 2026-06-11 Gemini Agent Empty Response

## Changed
- Added a chat-completion JSON fallback in `backend/src/services/providers.js` so streaming chat requests still work when a gateway ignores `stream: true` and returns a normal JSON response.
- Added Gemini native `candidates[].content.parts[]` parsing and `usageMetadata` normalization for compatible/provider responses.
- Added broader streaming delta fallbacks for Responses-style `response.output_text.delta`, message-content fallbacks, plain delta strings, and local gateway response diagnostics.
- Added backend empty-assistant diagnostics in `backend/src/routes/conversations.js`, including a short diagnostic id and safe structural metadata without logging prompts, replies, or API keys.
- Surfaced backend diagnostic ids in the chat recovery panel and copy action.

## Validation
- `node --test src/tests/providers.test.js`
- `node scripts/check-encoding.mjs`
- `npm run build` in `frontend`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
- Real local gateway check against `127.0.0.1:8317` with a minimal prompt confirmed the raw stream and `streamCompletion()` parser both receive `choices[0].delta.content`.

## Notes
- The likely root cause was a successful model response arriving in a non-SSE JSON shape while the chat path expected SSE chunks, causing the frontend to see no assistant payload.
- A later real gateway probe showed the minimal `gemini-pro-agent` request uses standard OpenAI-compatible SSE. If the full chat still returns empty, the new `providerDiagnostics` field in backend logs should reveal the exact stream event shape for that request.
