# 2026-06-08 Unreferenced Vue String Import Noise Guard

## Scope

- Continue hardening the unreferenced Vue component diagnostic without changing runtime behavior.
- Prevent documentation/example strings containing `import(...)`, `export ... from`, or `import.meta.glob(...)` text from hiding dormant components.
- Keep real import/export/glob references working so the scanner does not create false cleanup candidates.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-string-import-noise-guard.md`

## What Changed

- Added string-literal range detection before collecting Vue component reference literals.
- Filtered import/export/glob reference matches whose keyword starts inside a string literal.
- Added fixture coverage proving a real dynamic import still protects a component while a string-only import snippet does not.

## Validation

- PASS: Temporary fixture reproduced the previous false negative and now reports `StringImportOnlyWidget.vue` as an unreferenced candidate.
- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
  - 11 tests passed.
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Reported 0 unreviewed candidates.
  - Kept the 2 reviewed dormant components: `ExtensionManager.vue` and `VirtualMessageList.vue`.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 256 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `npm test` in `backend`
  - 573 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.
- Historical failure: an earlier `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` run failed once in `accessoryAgents.test.js`.
  - The same setup passed when reproduced directly.
  - `node --test src\tests\accessoryAgents.test.js`, `npm test`, and the final review gate all passed afterward.

## Notes

- The worktree already contained many unrelated runtime, test, and archived-report changes. This iteration only touched the unreferenced Vue diagnostic, its validation fixture, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue fixture-backed diagnostic hardening only where a concrete false positive or false negative is demonstrated.
