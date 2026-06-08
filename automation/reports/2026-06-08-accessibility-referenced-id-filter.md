# Vue Accessibility Referenced ID Filter

Date: 2026-06-08

## Scope

- Added `collectStaticAriaLabelledByIds()` in `scripts/find-inaccessible-vue-controls.mjs`.
- Changed `buildReferencedNameIndex()` to return early when a Vue file has no static `aria-labelledby` ids.
- Limited referenced-element body parsing to ids that are actually named by static `aria-labelledby`, instead of evaluating every static `id` in the file.
- Updated `backend/src/tests/validation-scripts.test.js` source contracts to require the referenced-id filter before building the name map.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Output: `{ "violations": [] }`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - 13 tests passed.
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 665 pass, 0 fail.
  - Frontend build: passed.

## Notes

- This preserves the existing static `aria-labelledby` heuristic while avoiding unnecessary body parsing for unrelated ids.
- Dynamic `aria-labelledby` bindings continue to be treated as provided accessible names without static id resolution.

## Next Recommended Task

Continue with focused diagnostic or source-hygiene cleanup while avoiding broad changes in the heavily modified business-code worktree.
