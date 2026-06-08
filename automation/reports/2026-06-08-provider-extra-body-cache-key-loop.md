# Provider Extra Body Cache Key Loop

## Summary

- Reworked `sortObject` in `backend/src/services/providers.js` to normalize nested arrays and sorted object keys with direct recursive loops instead of `Array.prototype.map` and `Array.prototype.reduce`.
- Added a public `listProviderModels` cache test that uses two key-order variants of the same nested `extraBody`, confirms one upstream `/models` call, and guards against returning to map/reduce-based normalization.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-extra-body-cache-key-loop.md`

## Validation

- PASS: `node --test backend\src\tests\backend.test.js --test-name-pattern "provider model cache normalizes nested extra body without array map/reduce allocation"`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- The change is behavior-preserving: stable cache keys still ignore object insertion order, while array order remains meaningful.
- No protected data, upload, environment, dependency, or build-output paths were edited.
