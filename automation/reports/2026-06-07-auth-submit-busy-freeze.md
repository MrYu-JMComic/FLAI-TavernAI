# 2026-06-07 Auth Submit Busy Freeze

## Goal

Prevent login and registration forms from accepting duplicate submits or navigation changes while an authentication request is pending.

## Changes

- Added submit-entry guards to `LoginView` and `RegisterView` when `loading` is already active.
- Marked both auth forms busy during submit.
- Disabled auth input fields while submit is pending.
- Disabled the auth-page switch buttons while submit is pending.
- Added focused source coverage for both auth views.

## Files Touched

- `frontend/src/views/LoginView.vue`
- `frontend/src/views/RegisterView.vue`
- `backend/src/tests/frontendAuthViews.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendAuthViews.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 492 backend tests and frontend build.

## Notes

- This keeps the existing authentication flow unchanged; it only aligns the visible controls and submit handlers with the existing loading state.
