# SSE Final Event Flush

Date: 2026-06-06

## Scope

Handle provider SSE streams that close without a trailing blank line after the final event.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`

## Change

- Flush `TextDecoder` when the SSE reader reaches EOF.
- Parse any remaining buffered SSE block after the read loop.
- Added a `streamCompletion` regression test for a final `data:` event without the usual trailing blank line.

## Why

Some gateways close a stream immediately after the last chunk instead of ending with the normal blank-line delimiter. The previous parser only emitted blocks separated by a blank line, so the final content event could be silently dropped.

## Validation

- `backend` `node --test src/tests/backend.test.js`: PASS, 141 tests.
- `node scripts/check-encoding.mjs`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including encoding check, 236 backend tests, frontend build, and git status audit.

## Risk

Low. Properly delimited events keep the same path; only residual buffered data at EOF is parsed once, and empty/comment-only buffers still produce no event.
