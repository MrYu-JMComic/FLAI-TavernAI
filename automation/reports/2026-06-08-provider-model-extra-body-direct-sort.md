# 2026-06-08 Provider Model Extra Body Direct Sort

## Goal

Keep provider model-cache refreshes allocation-light while preserving stable cache keys for nested `extraBody` settings.

## Changed Files

- `frontend/src/services/modelCatalog.js`
- `backend/src/tests/frontendProviderModels.test.js`
- `automation/backlog.md`

## Changes

- Replaced recursive `value.map(sortObject)` and `Object.keys(...).sort().reduce(...)` sorting in `modelCatalog` with direct array and own-key loops.
- Added a focused cache-read test proving differently ordered nested `extraBody` values hit the same provider-model cache entry.
- Added source guards to keep model-cache key normalization on the direct recursive path.

## Validation

- PASS: `node --test backend\src\tests\frontendProviderModels.test.js` (4 tests passed)
- PASS: `node scripts\check-encoding.mjs` (scanned 499 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (810 backend/source tests passed; frontend build passed)

## Next

- Continue scanning model and settings refresh paths for remaining no-op state writes and avoidable list allocations.
