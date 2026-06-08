# 2026-06-08 - Diagnostic CLI Blank Value Guard

## Scope

- Hardened `getCliOptionValue` so inline and separated blank option values return `null` instead of being treated as explicit paths or limits.
- Added behavior coverage for `--project-root=` and `--project-root ""` to keep diagnostic scanners on their existing default path behavior.
- Kept the change inside the shared diagnostic helper to avoid adding duplicate guard code to individual scanners.

## Changed Files

- `scripts/diagnostic-file-utils.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-diagnostic-cli-blank-value-guard.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue diagnostic hardening only where a shared helper or source-hygiene test can prevent duplicate patch logic from returning.
