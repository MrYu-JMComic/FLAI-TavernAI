# Provider Tool Call Normalization Loop

## Summary

- Reworked `normalizeToolCalls` in `backend/src/services/providers.js` to scan OpenAI-compatible `tool_calls` with one direct loop instead of building a mapped array and filtering null rows.
- Hardened the parser so null or nameless upstream tool-call entries are skipped instead of risking a crash.
- Added public `runToolCompletion` coverage that verifies only the valid tool call executes and guards against returning to source-array `map`/`filter` normalization.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-tool-call-normalization-loop.md`

## Validation

- PASS: `node --test backend\src\tests\backend.test.js --test-name-pattern "runToolCompletion skips malformed tool calls without source map/filter allocation"`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- The valid tool-call raw payload, fallback id shape, and JSON argument parsing remain unchanged.
- No protected data, upload, environment, dependency, or build-output paths were edited.
