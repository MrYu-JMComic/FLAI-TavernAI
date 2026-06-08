# 2026-06-08 - Unreferenced Vue Attribute Value Tags

## Scope

- Split Vue component tag matching from scoped `<component is>` matching in `scripts/find-unreferenced-vue-components.mjs`.
- Masked Vue attribute values for real tag-token scans so pseudo-markup such as `:is="'<DormantWidget />'"` cannot hide a dormant component.
- Kept a separate search text for static and string-literal `<component is>`, `:is`, and `v-bind:is` references.
- Added a fixture component that is mentioned only through pseudo-markup inside an `is` attribute value and must remain an unreferenced candidate.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-attribute-value-tags.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue hardening static diagnostics with fixture-backed false-negative cases before deleting or rewiring dormant frontend components.
