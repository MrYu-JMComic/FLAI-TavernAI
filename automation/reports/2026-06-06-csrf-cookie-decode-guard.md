# CSRF Cookie Decode Guard

Date: 2026-06-06

## Scope

Harden frontend CSRF token lookup when the browser cookie value is missing, unavailable, or malformed.

## Changed Files

- `frontend/src/api.js`

## Change

- `getCsrfToken()` now returns the current empty token when `document` or `document.cookie` is unavailable.
- Added `safeDecodeCookieValue(value)` so malformed percent-encoded cookie values do not throw `URIError`.
- If cookie decoding fails, the token remains empty and `ensureCsrfToken()` can request a fresh token from `/api/csrf-token`.

## Why

A manually corrupted or stale `flai_csrf` cookie could previously crash token lookup before the normal CSRF refresh path had a chance to run.

## Validation

- `node scripts/check-encoding.mjs`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: PASS, including encoding, 228 backend tests, frontend build, and git status audit.

## Risk

Low. Valid cookie tokens still decode and cache as before; only unavailable or malformed cookie states take the new fallback path.
