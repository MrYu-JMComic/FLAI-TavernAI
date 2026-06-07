# 2026-06-07 Auth Unused Validation Helper Cleanup

## Goal

Remove stale auth route helper code after verifying authentication and profile validation now flow through the shared schema middleware.

## Changes

- Removed unused private `validateCredentials` and `normalizeDisplayName` helpers from `backend/src/routes/auth.js`.
- Verified no repository references to those helper names remain.
- Kept the active `validate(registerSchema)`, `validate(loginSchema)`, and `validate(updateProfileSchema)` route validation paths unchanged.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/routes/auth.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-auth-unused-validation-helper-cleanup.md`

## Validation

- Passed: `node --test backend\src\tests\backend.test.js backend\src\tests\frontendAuthViews.test.js` (242 tests)
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (534 backend/source tests and frontend build)

## Notes

- Product behavior is unchanged; this only removes unused private route helpers.
- Existing parallel frontend, backend, backlog, and report worktree changes were preserved.
