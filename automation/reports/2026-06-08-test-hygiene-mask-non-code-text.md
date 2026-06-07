# 2026-06-08 Test Hygiene Mask Non-Code Text

## Scope

- Continue robustness hardening for repository quality checks.
- Prevent backend test-hygiene checks from treating comments or string fixture text as executable test code.
- Keep the change limited to `test-hygiene.test.js`; no runtime application behavior changes.

## Changed Files

- `backend/src/tests/test-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-test-hygiene-mask-non-code-text.md`

## What Changed

- Added a small masking pass that preserves line numbers while replacing string literals, template literals, line comments, and block comments with spaces.
- Routed focused/skipped/todo test detection and global mock assignment/restore checks through masked lines.
- Extracted focused/skipped/todo and mock guard scanning into fixture-testable helpers.
- Added fixture coverage proving comment and string text is ignored while real skipped tests and unguarded mock restores/assignments are still reported.

## Validation

- PASS: `node --test src\tests\test-hygiene.test.js` in `backend`
  - 6 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 254 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.

## Notes

- This reduces false positives in this repository's source-based tests, which frequently use strings and block fixtures that intentionally contain code-like snippets.
- The worktree already contained many unrelated pending source, test, and archived-report changes. This iteration only touched backend test hygiene coverage and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue improving diagnostics only where a concrete fixture can prove a false positive or false negative.
