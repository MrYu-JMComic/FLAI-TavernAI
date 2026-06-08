# 2026-06-08 - Accessibility Image Input Alt

## Scope

- Hardened `scripts/find-inaccessible-vue-controls.mjs` so `input type="image"` controls with non-empty or bound `alt` attributes are treated as named controls.
- Preserved unlabeled-control reporting for image inputs with empty static `alt` attributes.
- Added fixture coverage for named static and bound image inputs plus an empty-alt regression case.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-image-input-alt.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Keep tightening static accessibility diagnostics around native HTML naming rules before using them as cleanup gates.
