# 2026-06-08 - Diagnostic CLI Helper Refactor

## Scope

- Moved repeated diagnostic CLI option parsing, recursive file walking, and POSIX path normalization into `scripts/diagnostic-file-utils.mjs`.
- Updated the Vue accessibility and unreferenced-component diagnostics to use the shared helpers without changing their matching rules.
- Extended validation-script structure checks so future diagnostic patches do not reintroduce the duplicated helper layer.

## Changed Files

- `scripts/diagnostic-file-utils.mjs`
- `scripts/find-inaccessible-vue-controls.mjs`
- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-diagnostic-cli-helper-refactor.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue looking for repeated diagnostic-only infrastructure before touching chat runtime files, because the current worktree still contains parallel chat changes.
