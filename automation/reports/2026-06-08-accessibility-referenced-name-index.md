# Vue Accessibility Referenced Name Index

Date: 2026-06-08

## Scope

- Added `buildReferencedNameIndex()` in `scripts/find-inaccessible-vue-controls.mjs`.
- Replaced per-control static `aria-labelledby` id lookups with one per-file map of static ids to whether the referenced element provides an accessible name.
- Routed button, form-control, wrapping-label, and external-label name checks through the shared referenced-name index.
- Updated `backend/src/tests/validation-scripts.test.js` source contracts to require the indexed path and reject the old `findElementByStaticId()` / `referencedElementProvidesName()` lookup path.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Output: `{ "violations": [] }`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - 13 tests passed.
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 662 pass, 0 fail.
  - Frontend build: passed.

## Notes

- This keeps the diagnostic behavior focused on the current static-id heuristic while avoiding repeated full-template id scans.
- Duplicate static ids keep first-seen behavior by leaving the first indexed id result in place.

## Next Recommended Task

Continue with narrow diagnostic or source-hygiene work while the broader frontend and backend worktree remains heavily modified by parallel changes.
