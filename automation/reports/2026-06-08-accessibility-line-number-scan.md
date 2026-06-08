# 2026-06-08 Accessibility Line Number Scan

## Summary

Changed the Vue accessibility diagnostic `lineNumberAt` helper to count newline characters directly instead of allocating a substring and split array for every reported violation. This preserves reported line numbers while reducing avoidable allocation work in larger Vue templates.

While running the full review gate, a concurrent TalentRollDialog source-contract mismatch surfaced. The dialog already had the stronger stale action guard; this iteration only normalized the `clearAll` busy guard to the block form expected by the source test so the existing contract remains enforceable.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `frontend/src/components/TalentRollDialog.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-line-number-scan.md`

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json` (0 violations)
- PASS: `node --test backend\src\tests\validation-scripts.test.js` (13 tests)
- PASS: `node --test backend\src\tests\frontendTalentRollDialog.test.js` (4 tests)
- PASS: `node scripts\check-encoding.mjs` (317 files scanned)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `git diff --cached --check`
- PASS after retry: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 653 pass, 0 fail
  - Frontend build: passed

## Notes

- The first review-gate run failed on a concurrent TalentRollDialog source-test mismatch; after the minimal guard-format alignment, the full gate passed.
- Existing parallel frontend, backend, backlog, and report changes were preserved.
- No protected data, upload, environment, dependency, or generated build-output paths were edited.

## Next Recommended Task

Continue looking for small diagnostic hot-path allocation reductions, or pause production-file edits until the current Talent/Character parallel changes settle.
