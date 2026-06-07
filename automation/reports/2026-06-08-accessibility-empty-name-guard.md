# 2026-06-08 Accessibility Empty Name Guard

## Scope

- Continue improving diagnostic precision without changing runtime UI code.
- Prevent empty static accessible-name attributes from hiding unlabeled Vue controls.
- Keep dynamic bindings trusted so the diagnostic does not flag controls whose names are supplied at runtime.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-empty-name-guard.md`

## What Changed

- Split bound attributes from static attributes in the Vue accessibility scanner.
- Static `aria-label`, `aria-labelledby`, and `title` values now need non-empty trimmed text to count as an accessible name.
- `:aria-label`, `v-bind:aria-label`, and `v-bind:title` still count because the diagnostic cannot safely resolve runtime values.
- Added fixture coverage for empty-name controls and dynamic-name controls.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Reported 0 violations in the current frontend.
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Reported 0 unreviewed candidates and kept the 2 reviewed dormant components.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 246 files.
- PASS: `git diff --check`
  - Only existing LF-to-CRLF working-copy warnings were printed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding, unreferenced Vue component diagnostic, accessibility diagnostic, backend tests, frontend build, and final gate checks passed.

## Notes

- The worktree already contained many unrelated source, test, and report changes. This iteration only touched the accessibility diagnostic, its validation test, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue hardening diagnostics with fixture-backed false-positive or false-negative reductions before deleting or rewiring dormant code.
