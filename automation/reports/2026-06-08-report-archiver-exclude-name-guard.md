# Autonomous Iteration Report - 2026-06-08 - Report Archiver Exclude Name Guard

## Summary

Tightened the Markdown report archiver's `--exclude` parser so exclusions must
name a dated top-level report file. A typo such as `not-a-report.md` now fails
fast instead of silently doing nothing and allowing the intended report to be
archived.

## Changed Files

- `scripts/archive-markdown-reports.mjs`
  - Tightened the report filename pattern to reject path separators.
  - Reused the report filename pattern when validating `--exclude` values.
  - Kept valid dated report exclusions working with dry-run output.
- `backend/src/tests/validation-scripts.test.js`
  - Added fixture coverage for an invalid `--exclude not-a-report.md` value.
  - Verified the invalid exclusion exits before top-level report files are
    removed.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --check scripts\archive-markdown-reports.mjs`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
- PASS: `node scripts\archive-markdown-reports.mjs --all --exclude not-a-report.md --dry-run` rejected the invalid exclude value.
- PASS: `node scripts\archive-markdown-reports.mjs --all --exclude 2026-06-08-report-archiver-missing-option-guard.md --dry-run`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- This is intentionally a parser guard rather than broad report cleanup.
- Existing unrelated dirty worktree changes were preserved.

## Next Recommended Task

Continue with focused automation or diagnostic hardening where the script can
prove bad input is rejected before any file mutation occurs.
