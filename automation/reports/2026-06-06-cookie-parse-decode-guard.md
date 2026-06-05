# Cookie Parse Decode Guard

Date: 2026-06-06

## Scope

Harden backend cookie parsing against malformed percent-encoded cookie keys or values.

## Changed Files

- `backend/src/security.js`
- `backend/src/tests/backend.test.js`

## Change

- Added `safeDecodeCookiePart(value)` for cookie key/value decoding.
- `parseCookies()` now skips malformed encoded cookie pairs instead of throwing `URIError`.
- Added a regression test proving valid cookies still decode while malformed key/value pairs are ignored.

## Why

Malformed `Cookie` headers can come from stale browser state, manual edits, proxies, or malformed clients. The previous direct `decodeURIComponent()` calls could fail before authentication resolved, turning a bad cookie into a request-level server error.

## Validation

- `backend` `npm test`: PASS, 229 tests.
- `node scripts/check-encoding.mjs`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS, including encoding, 229 backend tests, frontend build, and git status audit.

## Risk

Low. Valid cookie parsing is unchanged; only malformed encoded cookie pairs take the new skip path.
