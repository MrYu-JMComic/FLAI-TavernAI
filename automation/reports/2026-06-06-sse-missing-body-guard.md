# SSE Missing Body Guard

Date: 2026-06-06

## Scope

Harden the frontend SSE path when an HTTP OK response does not expose a readable response body.

## Changed Files

- `frontend/src/api.js`

## Change

- Replaced the direct `response.body.getReader()` call in `streamSSE` with `getSseReader(response)`.
- Added `getSseReader(response)` to verify that the response body exists and supports `getReader`.
- Missing or unsupported stream bodies now use the existing `throwApiError` path with the user-facing message `流式响应不可用，请稍后重试。` and diagnostic detail `{ error: 'Missing response body' }`.

## Why

Some browser, proxy, or service-worker edge cases can produce a successful HTTP response without a readable stream. The previous direct call could surface a raw `TypeError` instead of the app's normalized API error handling.

## Validation

- `node scripts/check-encoding.mjs`: PASS.
- `frontend` `npm.cmd run build`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS, including encoding, 228 backend tests, frontend build, and git status audit.

## Risk

Low. The happy path still returns `response.body.getReader()` unchanged, and the new branch only handles a previously unnormalized missing-stream error.
