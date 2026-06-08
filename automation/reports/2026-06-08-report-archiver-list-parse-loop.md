# 2026-06-08 Report Archiver List Parse Loop

## Summary

Changed the Markdown report archiver's existing archive-file list parser to collect `Archived Files` entries with a direct regex loop instead of expanding `matchAll` into an intermediate array and mapping it. The archive output and duplicate-content checks stay the same while reducing avoidable allocation when dated archive files grow.

## Changed Files

- `scripts/archive-markdown-reports.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-report-archiver-list-parse-loop.md`

## Validation

- PASS: `node scripts\archive-markdown-reports.mjs --date 2099-01-01 --dry-run`
- PASS: `node --test backend\src\tests\validation-scripts.test.js` (13 tests)
- PASS: `node scripts\check-encoding.mjs` (320 files scanned before this report was added)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 656 pass, 0 fail
  - Frontend build: passed

## Notes

- Source-contract coverage now requires the `listItemPattern.exec(...)` loop and rejects the old `[...match[1].matchAll(...)]` expansion path.
- Existing parallel frontend, backend, backlog, archive, and report changes were preserved.
- No protected data, upload, environment, dependency, or generated build-output paths were edited.

## Next Recommended Task

Continue with small maintenance-script allocation cleanups, or switch back to production-file hardening after the current parallel NPC/Talent/Chat changes settle.
