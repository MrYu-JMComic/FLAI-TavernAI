# 2026-06-08 Report Archiver Created Date Loop

## Summary

Changed the Markdown report archiver's archive-created date formatter to collect `Intl.DateTimeFormat.formatToParts()` output with a direct loop instead of `Object.fromEntries(...map(...))`. The archive header date remains unchanged while avoiding an unnecessary intermediate pair array.

## Changed Files

- `scripts/archive-markdown-reports.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-report-archiver-created-date-loop.md`

## Validation

- PASS: `node scripts\archive-markdown-reports.mjs --date 2099-01-01 --dry-run`
- PASS: `node --test backend\src\tests\validation-scripts.test.js` (13 tests)
- PASS: `node scripts\check-encoding.mjs` (323 files scanned)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 656 pass, 0 fail
  - Frontend build: passed

## Notes

- Source-contract coverage now rejects the old `formatToParts(...).map(...)` date path so this small allocation cleanup does not regress.
- Existing parallel frontend, backend, backlog, archive, and report changes were preserved.
- No protected data, upload, environment, dependency, or generated build-output paths were edited.

## Next Recommended Task

Continue with small maintenance-script cleanups only where they simplify code or reduce avoidable work without changing behavior.
