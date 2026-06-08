# 2026-06-08 - Accessibility Provided Attribute Helper

## Scope

- Refactored `scripts/find-inaccessible-vue-controls.mjs` so dynamic or non-empty static attributes that provide names go through one `hasProvidedAttribute` helper.
- Reused that helper for direct `aria-label`, `title`, native input `value`/`alt`, and referenced `aria-labelledby` elements.
- Added fixture coverage for an `aria-labelledby` input whose referenced element has a bound `title`, preventing a false unlabeled-control report.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-provided-attribute-helper.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue consolidating repeated diagnostic helper patterns only when fixture coverage already proves the behavior boundary.
