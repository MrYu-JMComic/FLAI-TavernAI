# Unreferenced Vue Tag Prefix Guard

## Scope

- Tightened Vue component tag matching in the unreferenced component diagnostic so component names must end at a real tag boundary.
- Replaced prefix token checks like `<Foo` with tag-name regex checks that require whitespace, `/`, `>`, or the end of text after the component name.
- Added fixture coverage proving `<PrefixOnlyWidgetPanel />` does not make `PrefixOnlyWidget.vue` look referenced.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-tag-prefix-guard.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- The real project scan still reports no unreviewed Vue component cleanup candidates after the stricter tag boundary check.
