# Vue Accessibility External Label Index

Date: 2026-06-08

## Scope

- Added `buildExternalLabelNameIndex()` in `scripts/find-inaccessible-vue-controls.mjs`.
- Changed form-control accessibility checks to build the external `<label for="...">` name index once per Vue file, then reuse it for each control with a static `id`.
- Updated `backend/src/tests/validation-scripts.test.js` source contracts so the scanner keeps the per-file index path instead of returning to per-control full-template label scans.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Output: `{ "violations": [] }`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - 13 tests passed.
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 661 pass, 0 fail.
  - Frontend build: passed.

## Notes

- This is a focused diagnostic-script performance cleanup while the worktree remains heavily modified by parallel changes.
- Wrapping labels still use the local wrapping-label check, and external labels keep the same name rules as before.

## Next Recommended Task

Continue with narrowly scoped diagnostic or source-hygiene improvements while avoiding broad business-code rewrites until the parallel changes settle.
