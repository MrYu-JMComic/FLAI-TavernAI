# 2026-06-08 - Diagnostic Walk Order Stability

## Scope

- Made shared diagnostic file walking sort directory entries by name before yielding files.
- Tightened behavior coverage so `walkFiles` order is asserted directly instead of sorting the result inside the test.
- Kept the ordering rule in `diagnostic-file-utils.mjs` so Vue diagnostics share one deterministic traversal contract.

## Changed Files

- `scripts/diagnostic-file-utils.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-diagnostic-walk-order-stability.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue reducing diagnostic noise and duplicated helper behavior only where focused tests can prove the contract.
