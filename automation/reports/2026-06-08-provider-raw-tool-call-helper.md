# Provider Raw Tool Call Helper

## Summary

- Added a shared `collectRawToolCalls` helper in `backend/src/services/providers.js` so non-streaming and streaming tool completion loops forward assistant `tool_calls` through one direct loop.
- Replaced two duplicate `calls.map((call) => call.raw)` sites while preserving raw payload references and the OpenAI-compatible assistant message shape.
- Extended existing public tool completion tests so non-streaming and streaming raw tool-call forwarding cannot regress to array `map`.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-raw-tool-call-helper.md`

## Validation

- PASS: `node --test backend\src\tests\backend.test.js --test-name-pattern "(runToolCompletion skips malformed tool calls|streamToolCompletion normalizes streaming tool calls)"`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- The helper intentionally preserves the previous shallow raw-reference behavior; it does not deep-clone or rewrite provider tool-call payloads.
- No protected data, upload, environment, dependency, or build-output paths were edited.
