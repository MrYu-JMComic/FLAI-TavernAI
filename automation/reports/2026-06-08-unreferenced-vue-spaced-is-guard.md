# Unreferenced Vue Spaced Is Guard

## Scope

- Hardened the unreferenced Vue component diagnostic so static and bound `is` component references are recognized when whitespace appears around `=`.
- Refactored component tag checks and dynamic `is` attribute checks into separate scanner paths instead of adding more fixed token variants.
- Added fixture coverage for spaced static `is`, spaced `:is`, and spaced `v-bind:is` references.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-spaced-is-guard.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- The real project scan still reports no unreviewed Vue component cleanup candidates after this change.
- The fixture keeps existing noise-only component references in the candidate list, so the new spaced `is` matching does not reopen broad name-only false negatives.
