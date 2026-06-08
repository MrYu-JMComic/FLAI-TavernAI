# 2026-06-08 - Accessibility Input Button Values

## Scope

- Hardened `scripts/find-inaccessible-vue-controls.mjs` so native button-style inputs with non-empty or bound `value` attributes are treated as named controls.
- Preserved unlabeled-control reporting for button-style inputs with empty static `value` attributes.
- Added fixture coverage for named `submit` and bound `button` inputs plus an empty `submit` input regression case.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-input-button-values.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue reducing static diagnostic false positives that can misdirect cleanup or accessibility hardening work.
