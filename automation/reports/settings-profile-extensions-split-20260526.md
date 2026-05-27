# Settings Profile And Extensions Split - 2026-05-26

## Goal

Fix the personal center 404 request failure, restore Mod management API usage, and move non-personal management panels out of the personal center.

## Changes

- Added `GET /api/users/me/profile` and `PUT /api/users/me/profile` to `backend/src/routes/settings.js`.
- Added `/api/settings/provider` compatibility aliases so the existing frontend provider settings calls do not 404.
- Fixed missing Mod API imports in `frontend/src/views/SettingsView.vue`.
- Split `SettingsView` behavior by route:
  - `#/settings` shows personal profile and AI provider settings only.
  - `#/extensions` shows tags, presets, Mod, and regex management.
- Added `#/extensions` routing in `frontend/src/App.vue`.
- Added a top navigation entry for extensions in `frontend/src/components/BaseLayout.vue`.

## Validation

- `backend`: `npm.cmd test` passed, 128/128 tests.
- `frontend`: `npm.cmd run build` passed.
- `GET http://127.0.0.1:3001/api/users/me/profile` returns `401` when logged out instead of `404`, confirming the route exists.
- `GET http://127.0.0.1:3001/api/mods` returns `401` when logged out instead of `404`, confirming the route exists.
- Through the frontend dev proxy, `/api/settings/provider`, `/api/users/me/profile`, and `/api/mods` now return `401` when logged out instead of `404`.
- Restarted the backend dev server after the route changes; frontend remains on port `5173`, backend is listening on `3001`.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` could not run because `scripts/review-gate.ps1` is not present.
- In-app browser automation could not complete because the local browser runtime failed to initialize with `windows sandbox failed: setup refresh failed`.

## Safety

- Did not touch `backend/data`, `backend/uploads`, `.env`, `node_modules`, or generated build output intentionally.
- Existing broad uncommitted work was preserved.

## Next Recommended Task

Move extension management into its own dedicated Vue file once the current large uncommitted work is stabilized, so `SettingsView.vue` can stay focused on account/provider settings.
