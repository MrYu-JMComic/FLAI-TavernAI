# 2026-06-08 Test Hygiene Option Scope Guard

## Scope

- Continue backend test-hygiene hardening without changing runtime application behavior.
- Reduce false positives from ordinary `skip`, `todo`, or `only` object fields in test fixtures.
- Keep the change fixture-backed and limited to `backend/src/tests/test-hygiene.test.js`.

## Changed Files

- `backend/src/tests/test-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-test-hygiene-option-scope-guard.md`

## What Changed

- Scoped `skip`/`todo`/`only` option matching to active `test(...)`, `it(...)`, or `describe(...)` declaration headers.
- Kept direct `test.skip`, `test.only`, and `test.todo` detection unchanged.
- Preserved detection for real same-line and multiline disabled test options.
- Added fixture coverage showing ordinary object fields like `{ skip: true }` are ignored outside a test declaration.

## Validation

- PASS: `node --test src\tests\test-hygiene.test.js` in `backend`
  - 6 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 255 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.

## Notes

- Existing conditional skips such as `skip: !gitCommand || !powershellCommand` remain allowed because the guard intentionally targets committed unconditional skips and string/todo reasons.
- The worktree already contained many unrelated pending source, test, and archived-report changes. This iteration only touched backend test hygiene coverage and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue improving diagnostics only where a concrete fixture proves a false positive or false negative.
