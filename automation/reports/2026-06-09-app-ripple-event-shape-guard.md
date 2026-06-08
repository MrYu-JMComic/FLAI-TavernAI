# 2026-06-09 - App Ripple Event Shape Guard

## Changed Files

- `frontend/src/App.vue`
- `backend/src/tests/frontendAppRipple.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-app-ripple-event-shape-guard.md`

## Summary

- Guarded the global pointer ripple handler so malformed events without a target cannot throw before ripple target lookup.
- Added finite-coordinate fallbacks so synthetic pointer events without client coordinates place the ripple at the target center instead of writing `NaNpx`.

## Validation

- PASS: `node --test src/tests/frontendAppRipple.test.js` in `backend` (2 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 561 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (854 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

- Continue auditing global document and window handlers for direct event-field reads before null/shape checks.
