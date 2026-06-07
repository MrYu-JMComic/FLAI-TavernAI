# 2026-06-08 Unreferenced Vue Unquoted Is Guard

## Scope

- Continue hardening the unreferenced Vue component diagnostic without changing runtime behavior.
- Recognize simple unquoted static dynamic-component references such as `<component is=FooWidget />`.
- Preserve existing quoted static, bound static-string, import, export, and glob reference handling.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-unquoted-is-guard.md`

## What Changed

- Added PascalCase and kebab-case `is=...` tokens to the component reference search.
- Added fixture coverage for unquoted static `is` references in both PascalCase and kebab-case forms.
- Kept non-`is` attribute values masked so ordinary example strings still cannot hide dormant components.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
  - 11 tests passed.
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Reported 0 unreviewed candidates.
  - Kept the 2 reviewed dormant components: `ExtensionManager.vue` and `VirtualMessageList.vue`.
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Reported no violations.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 266 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.

## Notes

- The worktree already contained many unrelated runtime, test, and archived-report changes. This iteration only touched the unreferenced Vue diagnostic, its validation fixture, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue fixture-backed diagnostic hardening only where a concrete false positive or false negative is demonstrated.
