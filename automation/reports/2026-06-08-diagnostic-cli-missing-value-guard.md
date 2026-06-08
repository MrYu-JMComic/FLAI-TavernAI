# 2026-06-08 - Diagnostic CLI Missing Value Guard

## Scope

- Hardened `getCliOptionValue` so an option followed by another flag is treated as missing instead of using the flag as the option value.
- Added behavior coverage for the `--project-root --json` case to prevent diagnostics from accidentally resolving `--json` as a project path.
- Kept both Vue diagnostic scanners on the shared helper path.

## Changed Files

- `scripts/diagnostic-file-utils.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-diagnostic-cli-missing-value-guard.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Continue tightening diagnostic CLI edge cases only where behavior tests can prove the safer semantics.
