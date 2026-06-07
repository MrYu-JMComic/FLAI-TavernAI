# 2026-06-08 Accessibility Aria-Hidden Text Guard

## Scope

- Continue hardening the Vue accessibility diagnostic without changing runtime behavior.
- Prevent `aria-hidden="true"` icon or helper text from satisfying button and label accessible-name checks.
- Keep ordinary visible text, dynamic accessible-name attributes, and existing static label paths intact.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-aria-hidden-text-guard.md`

## What Changed

- Added a small aria-hidden text stripping path before the diagnostic checks visible button and label text.
- Covered both quoted and unquoted static `aria-hidden=true` values through the existing static attribute reader.
- Added fixture coverage proving a button with only hidden text and a label with only hidden text are reported as unlabeled.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
  - 11 tests passed.
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Reported no violations.
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Reported 0 unreviewed candidates.
  - Kept the 2 reviewed dormant components: `ExtensionManager.vue` and `VirtualMessageList.vue`.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 264 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.

## Notes

- The worktree already contained many unrelated runtime, test, and archived-report changes. This iteration only touched the accessibility diagnostic, its validation fixture, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue fixture-backed diagnostic hardening only where a concrete false positive or false negative is demonstrated.
