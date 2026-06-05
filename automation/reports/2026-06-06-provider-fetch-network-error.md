# Provider Fetch Network Error

Date: 2026-06-06

## Scope

Normalize provider-level network failures without changing HTTP error handling or user-cancelled abort behavior.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`

## Change

- Added a narrow `fetchProviderRequest()` wrapper used by provider requests.
- Non-abort `TypeError` fetch failures now throw `AI 请求失败，请检查网络、Base URL 或网关状态。`.
- `AbortError` and non-fetch assertion/programming errors still propagate unchanged.
- Added a `streamCompletion` regression test for provider fetch failures.
- Updated the character assistant test to match the current status-bar schema examples and restore `globalThis.fetch` in a `finally` block.

## Why

Network outages, DNS failures, and stopped local gateways can make `fetch()` reject before an HTTP response exists. Normalizing that path gives users actionable guidance while preserving abort semantics and keeping test failures visible.

## Validation

- `backend` `node --test src/tests/backend.test.js`: PASS, 140 tests.
- `node scripts/check-encoding.mjs`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including encoding check, 235 backend tests, frontend build, and git status audit.

## Risk

Low. HTTP responses still flow through the existing status/body handling, cancellations still throw `AbortError`, and only standard fetch `TypeError` failures take the new friendly branch.
