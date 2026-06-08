# Vue Accessibility No-Control Short Circuit

Date: 2026-06-08

## Scope

- Added `hasScannableControl()` to `scripts/find-inaccessible-vue-controls.mjs`.
- Skipped line-start, referenced-name, and external-label index setup for masked Vue files that contain no `button`, `input`, `textarea`, or `select` tags.
- Updated `backend/src/tests/validation-scripts.test.js` to require the short circuit before `buildLineStarts()`.
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

- The short circuit runs after existing script/style/comment/quoted-attribute masking, so pseudo controls inside non-template noise still do not trigger scanner work.
- No protected runtime data, upload, environment, dependency, or build-output paths were edited.

## Next Recommended Task

Continue with small source-hygiene or diagnostic cleanup while the broader business-code worktree remains heavily modified.
