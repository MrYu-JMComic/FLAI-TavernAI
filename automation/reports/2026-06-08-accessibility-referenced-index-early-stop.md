# Vue Accessibility Referenced Index Early Stop

Date: 2026-06-08

## Scope

- Added an early stop in `buildReferencedNameIndex()` once every static `aria-labelledby` id referenced in the file has been resolved.
- Updated `backend/src/tests/validation-scripts.test.js` to keep the referenced-name index contract from regressing to a full-file scan after all referenced ids are found.
- Recorded the completed iteration in `automation/backlog.md`.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Output: `{ "violations": [] }`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - 13 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 666 pass, 0 fail.
  - Frontend build: passed.

## Notes

- This preserves the scanner's existing first static-id match behavior while avoiding unnecessary tag scanning after the referenced-name map is complete.
- No protected runtime data, upload, environment, dependency, or build-output paths were edited.

## Next Recommended Task

Continue narrow diagnostic or source-hygiene cleanup while the business-code worktree remains heavily modified by parallel changes.
