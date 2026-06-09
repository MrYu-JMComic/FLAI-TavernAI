# 2026-06-09 - Auth Submit Stale Completion Guard

## Changed Files

- `frontend/src/views/LoginView.vue`
- `frontend/src/views/RegisterView.vue`
- `backend/src/tests/frontendAuthViews.test.js`
- `automation/reports/2026-06-09-navigation-completion-state-audit.md`
- `automation/backlog.md`

## Summary

- Added local submit tokens and unmount invalidation to both auth views.
- Guarded successful `authenticated` emits, error notifications, and final `loading` cleanup so stale login/register completions cannot write state after route replacement.
- Kept the change local to the auth views instead of adding a new abstraction for two small forms.

## Coverage

- Extended `backend/src/tests/frontendAuthViews.test.js` to require `onBeforeUnmount`, a submit token, stale success/error guards, and guarded `loading` cleanup in both auth views.

## Validation

- PASS: `node --test src/tests/frontendAuthViews.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue checking small async completion paths where a child emits navigation or close events before local cleanup runs.
