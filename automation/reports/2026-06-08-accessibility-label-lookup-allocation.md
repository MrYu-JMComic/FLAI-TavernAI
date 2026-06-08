# 2026-06-08 Accessibility Label Lookup Allocation

## Summary

Changed the Vue accessibility diagnostic wrapping-label lookup to use bounded `lastIndexOf` calls on the original template text instead of allocating a prefix substring for every form-control scan. This keeps wrapped-label detection behavior the same while reducing avoidable work in large Vue templates.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-label-lookup-allocation.md`

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json` (0 violations)
- PASS: `node --test backend\src\tests\validation-scripts.test.js` (13 tests)
- PASS: `node scripts\check-encoding.mjs` (318 files scanned before this report was added)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 653 pass, 0 fail
  - Frontend build: passed

## Notes

- Source-contract coverage now requires the bounded `text.lastIndexOf('<label', index)` path and rejects the old `text.slice(0, index)` prefix variable.
- Existing parallel frontend, backend, backlog, archive, and report changes were preserved.
- No protected data, upload, environment, dependency, or generated build-output paths were edited.

## Next Recommended Task

Continue with small diagnostic-script hot-path cleanups, especially places that still build intermediate arrays only to filter or map once.
