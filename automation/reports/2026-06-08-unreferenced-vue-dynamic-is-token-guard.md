# 2026-06-08 Unreferenced Vue Dynamic Is Token Guard

## Scope

- Continue improving the unreferenced Vue component diagnostic without changing runtime behavior.
- Avoid false cleanup candidates when a component is used through an explicit dynamic `is` string binding.
- Preserve the existing protections against comment-only, path-only, bare-name-only, and string-only noise.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-dynamic-is-token-guard.md`

## What Changed

- Added token coverage for `is="'ComponentName'"`, `is='"ComponentName"'`, and their kebab-case equivalents.
- Added fixture coverage for `<component :is="'BoundStringWidget'" />` and `<component v-bind:is="'bound-kebab-widget'" />`.
- Kept the unused fixture expectations strict so ordinary strings and comments still cannot hide dormant components.
- After the first review gate run exposed an unrelated dirty-test failure, realigned the NPC prompt route test to locate the main provider request instead of assuming the accessory-agent flow makes only one provider call.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
- PASS: `node --test src\tests\backend.test.js --test-name-pattern "chat prompt history keeps latest tied-timestamp messages in insertion order|chat prompt injects NPC memories and behaviors when NPC agent is active"` in `backend`
  - Node's runner still executed `backend.test.js`; all 242 tests passed.
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Reported 0 unreviewed candidates.
  - Kept the 2 reviewed dormant components: `ExtensionManager.vue` and `VirtualMessageList.vue`.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 244 files after this report was updated.
- PASS: `git diff --check`
  - Only existing LF-to-CRLF working-copy warnings were printed.
- PASS: `npm test` in `backend`
  - 557 tests passed after the first review-gate backend failure was corrected.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding, unreferenced Vue component diagnostic, accessibility diagnostic, backend tests, frontend build, and final gate checks passed.
  - An earlier run hit the tool timeout, and another exposed a transient backend-test failure; the backend suite passed on a standalone rerun and the final gate run passed.
- Historical failure: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - First run failed in backend tests because dirty `backend.test.js` assertions referenced stale provider-body variables and assumed a single provider call while the NPC accessory agent also calls the provider.

## Notes

- The worktree already contained many unrelated runtime, test, and report changes. This iteration intentionally stayed in the diagnostic script, its shared validation test, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue hardening diagnostics with fixture-backed false-positive reductions before removing or rewiring any dormant component.
