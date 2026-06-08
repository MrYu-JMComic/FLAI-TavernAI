# Provider Streaming Tool Call Loop

## Summary

- Reworked OpenAI-compatible streaming tool-call handling in `backend/src/services/providers.js` so source deltas and pending tool calls are normalized with direct loops instead of source `map` and pending `filter`/`map` chains.
- Preserved chunked argument assembly, pending-call insertion order, fallback tool-call ids, raw payload shape, and JSON argument parsing.
- Added public `streamToolCompletion` coverage for chunked streaming tool-call deltas with a nameless malformed row and a null row.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-streaming-tool-call-loop.md`

## Validation

- PASS: `node --test backend\src\tests\backend.test.js --test-name-pattern "streamToolCompletion normalizes streaming tool calls without source map/filter allocation"`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- This stays scoped to OpenAI-compatible streaming tool-call parsing; Anthropic and non-tool SSE parsing were not changed.
- No protected data, upload, environment, dependency, or build-output paths were edited.
