# 2026-06-08 Encoding Mojibake Marker Coverage

## Scope

- Continue the project robustness pass with a small diagnostic hardening change.
- Reduce the chance that common UTF-8-as-GBK mojibake slips into source or Markdown files.
- Keep the change fixture-backed and avoid broad report/archive churn.

## Changed Files

- `scripts/check-encoding.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-encoding-mojibake-marker-coverage.md`

## What Changed

- Added additional suspicious code points for common Chinese mojibake markers to `check-encoding.mjs`.
- Added a behavior test that copies the encoding checker into a temporary project, writes a bad Markdown fixture, runs the checker, and asserts that it fails with the corrupt file path.
- Verified the current repository still passes the stricter encoding scan.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
  - 11 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 249 files after the report was added.
- PASS: `git diff --check`
  - Only LF-to-CRLF working-copy warnings were printed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding, unreferenced Vue component diagnostic, accessibility diagnostic, backend tests, frontend build, and final status reporting passed.

## Notes

- The worktree already contained many unrelated pending source, test, and archived-report changes. This iteration only touched the encoding checker, its validation coverage, and reporting files.
- A Node-based UTF-8 read of `automation/backlog.md` showed the current backlog text is valid; the mojibake seen in a PowerShell transcript was terminal display behavior, not file content.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue strengthening diagnostics with executable fixtures before making runtime changes, especially around unused-code and source-hygiene checks.
