# Frontend Images, CSRF, And Mobile Home Fix - 2026-05-25 23:37

## Goal

Fix broken image resources, mobile home character list layout issues, and login failures caused by missing CSRF tokens.

## Changes

- Added `GET /api/avatars/:id` in `backend/src/server.js` to serve base64 avatar assets as real image responses with viewer permission checks.
- Updated `frontend/src/api.js` so all mutation requests, including login/register and bodyless POST/DELETE calls, wait for a CSRF token before sending.
- Updated streaming chat requests to fetch CSRF before opening the SSE request.
- Improved mobile home character list sizing in `frontend/src/views/HomeView.vue` and added narrow-screen card layout overrides in `frontend/src/styles.css`.

## Validation

- `node --check backend/src/server.js` passed.
- `backend`: `npm.cmd test` passed, 123/123 tests.
- `frontend`: `npm.cmd run build` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` could not run because `scripts/review-gate.ps1` is not present in this workspace.
- Through `http://localhost:5175` proxy:
  - `GET /api/csrf-token` returned a token.
  - `POST /api/auth/login` succeeded for the existing test account.
  - `GET /api/characters` returned 3 characters.
  - `GET /api/avatars/893494e0-932b-4a99-8315-63e0ffa9f7aa` returned `200 image/jpeg`.

## Notes

- The frontend build still reports the existing large Markdown chunk warning.
