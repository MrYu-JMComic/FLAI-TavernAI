# Unreferenced Vue Bound Is Expression Guard

## Scope

- Tightened the unreferenced Vue component diagnostic so bound dynamic `:is` and `v-bind:is` values only count as component references when they are string literal expressions.
- Kept plain static `is` support for PascalCase, kebab-case, quoted, unquoted, and spaced attributes.
- Added fixture coverage proving a bare dynamic expression like `:is="DynamicExpressionOnlyWidget"` does not hide a dormant component file.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-bound-is-expression-guard.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- Existing frontend dynamic component usages are variable or function expressions such as `currentView`, `action.icon`, and `iconFor(...)`; those should not be treated as direct file-level references for dead-component cleanup.
