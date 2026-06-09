# 2026-06-09 - Provider Model Select Direct Scan

## Changed Files

- `frontend/src/services/modelCatalog.js`
- `backend/src/tests/frontendProviderModels.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-provider-model-select-direct-scan.md`

## Summary

- Replaced the provider model select current-model membership `.some()` callback with a direct helper scan.
- Appended normalized model options into the returned list with one direct loop instead of spread-array merging.
- Kept missing current saved models visible ahead of normalized rows so settings and model-picker UI retain the same behavior with less computed allocation work.

## Coverage

- Added a behavior test for missing-current-model preservation and normalized model ordering.
- Added a source guard requiring `buildModelSelectOptions()` to use the direct scan helper and preventing the old `.some()` plus spread return path from returning.

## Validation

- PASS: `node --test src/tests/frontendProviderModels.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing settings and model-selection UI computed values for redundant list rebuilding or stale async cleanup paths.
