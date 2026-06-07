# 2026-06-08 Unreferenced Vue Regex Import Noise Guard

## Scope

- Continue hardening the unreferenced Vue component diagnostic without changing runtime behavior.
- Prevent JavaScript or TypeScript regex literals containing static import-like examples from hiding dormant Vue components.
- Preserve real import/export/dynamic import/glob reference detection.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-regex-import-noise-guard.md`

## What Changed

- Added regex-literal range collection for component reference literal scanning.
- Skipped import/export/glob matches whose keyword starts inside a regex literal.
- Added fixture coverage proving `/import RegexStaticImportOnlyWidget from '..\\/components\\/RegexStaticImportOnlyWidget.vue'/` does not count as a real component import.
- Kept regex-start detection on a bounded token scan instead of slicing the whole source prefix for each slash, avoiding a diagnostic performance regression.

## Validation

- PASS: Temporary fixture reproduced the previous false negative and now reports `RegexStaticImportOnlyWidget.vue` as an unreferenced candidate.
- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
  - 11 tests passed.
  - The unreferenced Vue scanner coverage completed its current-repo scan in about 0.65 seconds after replacing prefix slicing with bounded token scanning.
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Reported 0 unreviewed candidates.
  - Kept the 2 reviewed dormant components: `ExtensionManager.vue` and `VirtualMessageList.vue`.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 262 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.

## Notes

- The worktree already contained many unrelated runtime, test, and archived-report changes. This iteration only touched the unreferenced Vue diagnostic, its validation fixture, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue fixture-backed diagnostic hardening only where a concrete false positive or false negative is demonstrated.
