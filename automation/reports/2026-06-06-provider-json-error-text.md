# Provider JSON Error Text

Date: 2026-06-06

## Scope

Preserve useful upstream provider error text when non-streaming provider endpoints return plain text or otherwise non-JSON bodies.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`

## Change

- `readJsonResponse(response)` now reads the response body once as text, parses JSON from that captured text, and reuses the same text for fallback error messages.
- Added `providerJsonErrorMessage(json)` and `responseErrorMessage(response, text)` helpers for consistent provider error extraction.
- Added a regression test proving `/models` failures with a plain-text upstream body surface the upstream message instead of losing it after JSON parsing consumes the body.

## Why

Some provider gateways return text or HTML on errors. The previous `response.json().catch(...response.text())` pattern could lose the original response body after the JSON parse attempt consumed it, reducing diagnostics to a generic status-only message.

## Validation

- `backend` `npm test`: PASS, 232 tests.
- `node scripts/check-encoding.mjs`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS, including encoding, 232 backend tests, frontend build, and git status audit.

## Risk

Low. Successful JSON responses still return the parsed JSON object; the change only improves fallback handling for malformed or non-JSON provider responses.
