# Vue Accessibility Element Body Range Helper

Date: 2026-06-08

## Scope

- Added `findElementBodyRange()` in `scripts/find-inaccessible-vue-controls.mjs`.
- Routed both referenced-name body extraction and button body scanning through the shared body-range helper.
- Removed the button-specific close-tag lookup path so future scanner changes do not maintain two equivalent close-tag flows.
- Updated `backend/src/tests/validation-scripts.test.js` to require the shared helper path and reject the old button-only close pattern.
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

- Missing button close tags still skip the button scan as before.
- Missing referenced-name close tags still produce an empty body as before.
- No protected runtime data, upload, environment, dependency, or build-output paths were edited.

## Next Recommended Task

Continue small diagnostic or source-hygiene cleanup while avoiding broad business-code edits in the heavily modified worktree.
