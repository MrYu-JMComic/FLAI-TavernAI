# 2026-06-09 - Model Catalog Direct Values

## Changed Files

- `frontend/src/services/modelCatalog.js`
- `backend/src/tests/frontendProviderModels.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-model-catalog-direct-values.md`

## Summary

- Replaced provider model catalog `Map.values()` spread sorting with a direct collection helper.
- Reused a named id comparator instead of allocating an inline sort callback during model normalization.
- Preserved model dedupe and sorted option behavior for Settings, Chat settings, and provider model cache refresh paths.

## Coverage

- Added behavior coverage for deduped, sorted provider model normalization.
- Added a source guard requiring `normalizeModelList()` to return through `collectSortedModelValues()`.
- Added a regression check preventing the previous `return [...byId.values()].sort(...)` path from returning.

## Validation

- PASS: `node --test src/tests/frontendProviderModels.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing active HomeView filtering and sorting helpers for stale UI updates and callback-heavy computed paths.
