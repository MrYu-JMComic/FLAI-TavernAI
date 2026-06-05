# Provider Extra Body Object Guard

Date: 2026-06-06

## Scope

Prevent malformed provider `extraBody` values from polluting upstream request bodies.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`

## Change

- Added a `providerExtraBody()` guard that only accepts plain object extra body values.
- Applied the guard to chat completions, Anthropic messages, OpenAI Responses requests, and provider model cache keys.
- Added a `buildProviderBody` regression test for array and string `extraBody` values.

## Why

Provider extra body is intended to merge additional JSON object fields into upstream requests. If a form or saved setting supplies JSON arrays or scalar values, object spread can create unexpected numeric request fields such as `0`, which is not a valid provider option.

## Validation

- `backend` `node --test src/tests/backend.test.js`: PASS, 142 tests.
- `node scripts/check-encoding.mjs`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including encoding check, 237 backend tests, frontend build, and git status audit.

## Risk

Low. Plain object `extraBody` values keep the existing behavior; arrays and scalar values are invalid for request-field merging and now become an empty extra body.
