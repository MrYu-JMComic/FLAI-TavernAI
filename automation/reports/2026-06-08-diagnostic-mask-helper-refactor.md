# 2026-06-08 - Diagnostic Mask Helper Refactor

## Scope

- Added a shared `maskNonNewlineText` helper to `scripts/diagnostic-file-utils.mjs` for line-preserving diagnostic text masking.
- Updated the Vue accessibility diagnostic to reuse the shared helper for HTML comments and SFC script/style blocks.
- Updated the unreferenced Vue component diagnostic to reuse the shared helper instead of keeping a local duplicate.
- Extended validation-script structure checks to keep the shared helper wired into both diagnostics.

## Changed Files

- `scripts/diagnostic-file-utils.mjs`
- `scripts/find-inaccessible-vue-controls.mjs`
- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-diagnostic-mask-helper-refactor.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue consolidating small diagnostic infrastructure only where the behavior boundary is already covered by fixture-backed tests.
