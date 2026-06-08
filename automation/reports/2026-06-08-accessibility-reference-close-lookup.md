# Vue Accessibility Reference Close Lookup

Date: 2026-06-08

## Scope

- Updated `scripts/find-inaccessible-vue-controls.mjs` so `findElementByStaticId()` sets `closePattern.lastIndex = tagEnd + 1` and runs `closePattern.exec(text)` on the original source text.
- Avoided allocating `text.slice(tagEnd + 1)` while scanning a referenced `aria-labelledby` element body.
- Updated `backend/src/tests/validation-scripts.test.js` source contracts to require the direct-text close-tag lookup and reject the older sliced lookup.

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

- This is intentionally a tiny diagnostic-script performance cleanup while the worktree remains heavily modified by parallel changes.
- The emitted accessibility diagnostic behavior remains unchanged.

## Next Recommended Task

Continue with narrowly scoped diagnostic or source-hygiene improvements until the parallel business-code changes settle.
