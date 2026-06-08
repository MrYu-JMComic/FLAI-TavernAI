# Autonomous Iteration Report - 2026-06-08 - Diagnostic Locale-Independent Ordering

## Summary

Made Vue diagnostic ordering independent from host locale settings by routing
shared file walking and scanner result sorting through one code-unit text
comparator.

## Changed Files

- `scripts/diagnostic-file-utils.mjs`
  - Added `compareDiagnosticText`.
  - Reused it for deterministic directory entry ordering in `walkFiles`.
- `scripts/find-inaccessible-vue-controls.mjs`
  - Reused `compareDiagnosticText` for violation file/control sorting.
- `scripts/find-unreferenced-vue-components.mjs`
  - Reused `compareDiagnosticText` for unreferenced component sorting.
- `backend/src/tests/validation-scripts.test.js`
  - Added behavior coverage for case-sensitive diagnostic ordering.
  - Added structural guards so the Vue diagnostics do not drift back to
    default `localeCompare` sorting.
- `automation/backlog.md`
  - Recorded this completed iteration.

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- The review gate reported 617 backend tests passing and the frontend Vite
  production build passing.
- Git continued to print LF/CRLF conversion warnings only; no whitespace errors
  were reported.
- Existing unrelated dirty worktree files were preserved.

## Next Recommended Task

Audit the remaining source-hygiene diagnostics for any output ordering that still
depends on default locale behavior, and only change it if the scanner output is
review-facing or gate-facing.
