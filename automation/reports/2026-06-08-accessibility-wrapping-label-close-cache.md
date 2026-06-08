# Accessibility Wrapping Label Close Cache

## Scope

- Routed `findWrappingLabel()` through `getClosingTagPattern('label')` instead of creating a fresh `</label>` regex for every form-control lookup.
- Kept the cached global regex safe by resetting `labelClosePattern.lastIndex = index` before each scan.
- Updated the validation source contract to require the cached wrapping-label lookup and reject the old inline regex literal.
- Recorded the completed task in `automation/backlog.md`.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Result: `{ "violations": [] }`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 339 files; no common Chinese mojibake markers found.
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 667 tests, frontend build passed, review gate passed.

## Notes

- Behavior is intended to stay unchanged; this only removes a repeated regex allocation in a hot form-control path.
- The wrapping label lookup now shares the same cached closing-tag helper as element body scans, keeping the scanner implementation smaller and more consistent.
- The repository still has many unrelated or parallel dirty files; this iteration only changes the focused scanner path, validation contract, backlog entry, and report.

## Next Recommended Task

- Continue auditing the Vue diagnostics for similarly small repeated scan/allocation patterns that can reuse existing helpers without adding new abstractions.
