# 2026-06-08 Accessibility Unquoted Static Attributes

## Scope

- Continue hardening the Vue accessibility diagnostic without changing runtime behavior.
- Avoid false unlabeled-control reports when Vue templates use simple unquoted static attribute values.
- Keep the existing quoted-attribute and dynamic-attribute behavior intact.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-unquoted-static-attrs.md`

## What Changed

- Updated static attribute parsing to read both quoted and unquoted values.
- Added fixture coverage for unquoted `aria-label`, `title`, `for`, `id`, and `aria-labelledby` accessible-name paths.
- Kept the expected accessibility violation count unchanged because the new fixture controls are intentionally labeled.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
  - 11 tests passed.
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Reported no violations.
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Reported 0 unreviewed candidates.
  - Kept the 2 reviewed dormant components: `ExtensionManager.vue` and `VirtualMessageList.vue`.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 262 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.

## Notes

- The worktree already contained many unrelated runtime, test, and archived-report changes. This iteration only touched the accessibility diagnostic, its validation fixture, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue fixture-backed diagnostic hardening only where a concrete false positive or false negative is demonstrated.
