# 2026-06-09 - WorldBook Mutation Navigation Guard

## Changed Files

- `frontend/src/views/WorldBookView.vue`
- `backend/src/tests/frontendWorldBookView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-worldbook-mutation-navigation-guard.md`

## Summary

- Added a small WorldBook mutation navigation helper that invalidates the local mutation token before emitting route navigation.
- Routed successful world book creation, detail deletion, and AI-draft creation navigations through the helper so their `finally` blocks cannot clear `saving` in a stale route context.
- Kept the change local to the existing WorldBook route guard model instead of adding a broad abstraction.

## Coverage

- Extended `frontendWorldBookView.test.js` to require the helper and the three mutation-triggered navigation call sites.
- Kept existing saving-lock and form-reset source tests intact.

## Validation

- PASS: `node --test src/tests/frontendWorldBookView.test.js` in `backend`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing small async success paths that emit navigation or close events before local cleanup, prioritizing cases with an existing token guard that can be reused without extra framework code.
