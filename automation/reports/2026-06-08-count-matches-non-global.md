# 2026-06-08 Count Matches Non Global

## Summary

Frontend SFC source tests can now use `countMatches()` with either global or non-global regular expressions without tripping over `String.prototype.matchAll()` global-flag requirements.

## Changed Files

- `backend/src/tests/frontendSfcTestUtils.js`
  - Clones regular expressions with a global flag before counting matches, preserving existing global-regex behavior while accepting non-global regexes.
- `backend/src/tests/frontendSfcTestUtils.test.js`
  - Added focused coverage for global, non-global, and case-insensitive regex counts.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendSfcTestUtils.test.js` in `backend` (1 test passed)
- PASS: `node scripts/check-encoding.mjs` (scanned 531 files)
- PASS: `git diff --check`
- PASS: `npm.cmd test` in `backend` (831 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Continue checking shared source-test helpers for brittle assumptions that can hide real frontend regressions behind test utility failures.
