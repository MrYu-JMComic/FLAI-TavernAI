# 2026-06-08 - Accessibility Attribute Markup Noise

## Scope

- Hardened `scripts/find-inaccessible-vue-controls.mjs` so quoted Vue attribute values can contain example markup without being scanned as real controls.
- Preserved real static and bound accessibility attributes by masking only `<` and `>` characters inside quoted attribute values.
- Added fixture coverage for `data-example` markup containing fake `button`, `input`, `textarea`, and `select` controls.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-attribute-markup-noise.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue adding fixture-backed diagnostics for static-analysis false positives and false negatives before using those diagnostics as cleanup gates.
