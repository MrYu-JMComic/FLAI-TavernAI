# Provider SSE Reader Error

Date: 2026-06-06

## Scope

Normalize backend provider SSE stream read failures after a readable body has already been opened.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`

## Change

- Added `readSseChunk(reader)` around `reader.read()`.
- Non-abort stream read failures now throw `AI 流式响应中断，请稍后重试。` instead of surfacing a low-level reader error such as `TypeError: socket closed`.
- Added a `streamCompletion` regression test for a `ReadableStream` that errors during read.

## Why

Provider gateways and network layers can drop a streaming response after headers are received. Normalizing this failure keeps user-visible errors actionable while preserving `AbortError` behavior for caller-initiated cancellation.

## Validation

- `backend` `npm.cmd test`: PASS, 233 tests.
- `node scripts/check-encoding.mjs`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including encoding check, backend tests, frontend build, and git status audit.

## Risk

Low. Successful streams use the same parsing path, and aborts still propagate as aborts; only unexpected read failures take the new friendly error branch.
