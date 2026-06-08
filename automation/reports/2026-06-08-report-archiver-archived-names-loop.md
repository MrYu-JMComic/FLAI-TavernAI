# 2026-06-08 Report Archiver Archived Names Loop

## Summary

Changed the Markdown report archiver to collect newly archived report names while it appends each new section, instead of remapping `newSections` at return time. The JSON result shape stays the same, and duplicate top-level report counting now uses the same collected-name list.

## Changed Files

- `scripts/archive-markdown-reports.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-report-archiver-archived-names-loop.md`

## Validation

- PASS: `node scripts\archive-markdown-reports.mjs --date 2099-01-01 --dry-run`
- PASS: `node --test backend\src\tests\validation-scripts.test.js` (13 tests)
- PASS: `node scripts\check-encoding.mjs` (324 files scanned)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 656 pass, 0 fail
  - Frontend build: passed

## Notes

- Source-contract coverage now rejects returning `archived` through `newSections.map(...)`.
- Existing parallel frontend, backend, backlog, archive, and report changes were preserved.
- No protected data, upload, environment, dependency, or generated build-output paths were edited.

## Next Recommended Task

Continue with scoped maintenance-script cleanup or return to production-file hardening once the current parallel frontend/backend edits settle.
