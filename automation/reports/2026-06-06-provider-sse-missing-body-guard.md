# Provider SSE Missing Body Guard

Date: 2026-06-06

## Scope

Harden backend provider SSE parsing when an upstream provider returns an HTTP OK streaming response without a readable body.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`

## Change

- Added a readable-stream guard at the start of `parseSse(stream)`.
- Missing or non-readable SSE bodies now throw `AI 流式响应不可用，请稍后重试。` instead of a raw `TypeError` from `stream.getReader()`.
- Added a `streamCompletion` regression test for a `text/event-stream` response with a `null` body.

## Why

Provider gateways, proxies, or fetch implementations can produce successful responses without a usable stream body. Normalizing that edge case keeps streaming failures actionable and prevents low-level runtime errors from leaking through.

## Validation

- `backend` `npm test`: PASS, 231 tests.
- `node scripts/check-encoding.mjs`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS, including encoding, 231 backend tests, frontend build, and git status audit.

## Risk

Low. Valid streaming responses still use the same `getReader()` and parsing path; only missing or incompatible stream bodies hit the new error branch.
