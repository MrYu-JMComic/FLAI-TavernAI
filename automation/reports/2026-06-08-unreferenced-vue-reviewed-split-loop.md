# 2026-06-08 Unreferenced Vue Reviewed Split Loop

## Summary

Changed the unreferenced Vue component diagnostic to classify unreviewed candidates and reviewed dormant components in one direct pass. The scanner output shape is unchanged, but it no longer filters the same unreferenced component list twice and then maps the reviewed branch separately.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-reviewed-split-loop.md`

## Validation

- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Result: 0 unreviewed candidates, 2 reviewed dormant components
- PASS: `node --test backend\src\tests\validation-scripts.test.js` (13 tests)
- PASS: `node scripts\check-encoding.mjs` (325 files scanned)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 656 pass, 0 fail
  - Frontend build: passed

## Notes

- Source-contract coverage now rejects the previous repeated `unreferencedComponents.filter(...)` split.
- Existing parallel frontend, backend, backlog, archive, and report changes were preserved.
- No protected data, upload, environment, dependency, or generated build-output paths were edited.

## Next Recommended Task

Continue with scoped diagnostic or maintenance-script cleanup where it removes repeated traversal without making the code harder to read.
