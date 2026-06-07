# 2026-06-08 Unreferenced Vue Attribute String Noise Guard

## Scope

- Continue hardening the unreferenced Vue component diagnostic without changing runtime behavior.
- Prevent ordinary Vue template attribute examples such as `data-example="<Foo />"` from hiding dormant components.
- Preserve real dynamic component references through `is`, `:is`, and `v-bind:is`.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-attribute-string-noise-guard.md`

## What Changed

- Added Vue template attribute-value masking before component token scans.
- Kept component `is` attributes visible so static and bound dynamic component usage remains recognized.
- Added fixture coverage proving a non-`is` attribute example string is reported as unreferenced while `<component is="...">` remains referenced.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
  - 11 tests passed.
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Reported 0 unreviewed candidates.
  - Kept the 2 reviewed dormant components: `ExtensionManager.vue` and `VirtualMessageList.vue`.
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Reported no violations.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 261 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.

## Notes

- The worktree already contained many unrelated runtime, test, and archived-report changes. This iteration only touched the unreferenced Vue diagnostic, its validation fixture, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue fixture-backed diagnostic hardening only where a concrete false positive or false negative is demonstrated.
