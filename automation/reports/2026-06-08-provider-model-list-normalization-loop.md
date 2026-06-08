# Provider Model List Normalization Loop

## Summary

- Replaced provider `/models` source row normalization with a direct loop.
- Preserved model id sorting, label/owner fallback behavior, and cloned return values.
- Added public `listProviderModels` coverage proving invalid rows are skipped and source rows no longer depend on array `map`/`filter`.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-model-list-normalization-loop.md`

## Validation

- PASS: `node --test --test-name-pattern "provider model list normalizes model rows without source map/filter allocation" backend\src\tests\backend.test.js` (1 test)
- PASS: `node --test backend\src\tests\backend.test.js` (255 tests)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (697 backend tests plus frontend build)
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: protected path status check

## Next Recommended Task

- Continue provider-path cleanup only when cache, compatibility, and parser behavior can be covered through public tests.
