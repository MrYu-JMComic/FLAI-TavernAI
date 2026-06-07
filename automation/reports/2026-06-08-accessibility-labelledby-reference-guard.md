# 2026-06-08 Accessibility Labelledby Reference Guard

## Scope

- Continue Vue accessibility diagnostic hardening without changing runtime UI behavior.
- Close a false-negative path where a static `aria-labelledby` value could hide an unlabeled control even when the referenced element was missing or empty.
- Keep the change fixture-backed and limited to the existing scanner.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-labelledby-reference-guard.md`

## What Changed

- Split static `aria-label` handling from static `aria-labelledby` handling.
- Static `aria-labelledby` values now count only when at least one referenced element exists and provides visible text or a static name.
- Dynamic `aria-label` and `aria-labelledby` bindings remain accepted because their runtime values cannot be proven by this static diagnostic.
- Added fixture coverage for valid, missing, and empty `aria-labelledby` references.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
  - 11 tests passed.
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Reported no violations in the current frontend.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 253 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.

## Notes

- The only current frontend `aria-labelledby` usage is a dialog title reference in `CharacterFormView.vue`; the accessibility scanner focuses on buttons and form controls, so no runtime UI files needed changes.
- The worktree already contained many unrelated pending source, test, and archived-report changes. This iteration only touched the accessibility diagnostic, its fixture coverage, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue hardening diagnostics only where fixture evidence shows a concrete false negative or false positive.
