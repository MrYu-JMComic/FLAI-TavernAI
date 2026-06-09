# 2026-06-09 - Character Form Navigation Token Guard

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-character-form-navigation-token-guard.md`

## Summary

- Invalidated the character form submit token before navigation from a newly-created character to its edit route.
- Invalidated the character delete token before navigating back home after deletion.
- Preserved the existing direct edit-save navigation so same-route saves still clear `saving` normally.

## Coverage

- Extended `frontendCharacterFormView.test.js` to require the submit and delete navigation helpers.
- Added coverage that only the route-replacing create-submit path uses submit-token invalidation while edit saves keep the existing direct navigation path.

## Validation

- PASS: `node --test src/tests/frontendCharacterFormView.test.js` in `backend`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing async success paths that emit navigation or close events after a token guard, especially where same-route actions and route-replacing actions share one handler.
