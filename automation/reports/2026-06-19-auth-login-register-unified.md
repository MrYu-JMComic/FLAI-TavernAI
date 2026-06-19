# 2026-06-19 Auth login/register unified

## Summary

Implemented the Phase 2 login/register consolidation from the master UX plan. Login and register now use one shared `AuthView` with segmented mode switching, inline form errors, password visibility toggles, and the same stale-submit guard as the previous standalone forms.

## Changed files

- `frontend/src/views/AuthView.vue`
- `frontend/src/views/LoginView.vue`
- `frontend/src/views/RegisterView.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendAuthViews.test.js`
- `automation/reports/2026-06-19-auth-login-register-unified.md`

## Validation

- Passed: `cd backend && node --test src/tests/frontendAuthViews.test.js`
- Passed: `cd frontend && npm run build`
  - Includes prebuild encoding check.
- Passed: `node scripts/find-inaccessible-vue-controls.mjs --json`
  - Result: `violations: []`
- Passed: `node scripts/check-encoding.mjs`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
  - Result: 962 backend tests passed.

## Notes

- No backend API, database schema, dependency, environment, upload, local data, or generated output change was required.
- `LoginView.vue` and `RegisterView.vue` remain as route-compatible wrappers, but the duplicate form fields, validation, submit handling, and stale completion logic were removed from those route files.
- The route model remains compatible with direct `#/login` and `#/register` entry while users can switch modes in the same auth panel.
