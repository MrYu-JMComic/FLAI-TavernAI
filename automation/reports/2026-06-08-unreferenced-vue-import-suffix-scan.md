# Unreferenced Vue Import Suffix Scan

## Summary

- Replaced the unreferenced Vue component scanner's import-suffix regex split with a direct character scan.
- Preserved existing behavior for `?` and `#` import suffixes while avoiding a short-lived array allocation for each scanned reference literal.
- Added a validation-script source contract so this helper does not regress to the regex split path.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/reports/2026-06-08-unreferenced-vue-import-suffix-scan.md`

## Validation

- PASS: `node scripts/find-unreferenced-vue-components.mjs --json`
  - Result: 0 candidates, 2 reviewed dormant components.
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `node scripts/check-encoding.mjs`
  - Result: scanned 387 files; no common Chinese mojibake markers found.
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 738 tests, frontend build passed, review gate passed.

## Next Recommended Task

- Continue trimming allocation-heavy diagnostic hot paths only where the replacement stays smaller and easier to reason about than the original code.
