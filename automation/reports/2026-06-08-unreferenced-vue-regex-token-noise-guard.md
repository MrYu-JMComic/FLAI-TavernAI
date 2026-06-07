# 2026-06-08 Unreferenced Vue Regex Token Noise Guard

## Scope

- Continue hardening the unreferenced Vue component diagnostic without changing runtime behavior.
- Prevent JavaScript or TypeScript regex literals containing component-like tags from hiding dormant Vue components.
- Keep real imports, globs, template tags, and dynamic `is` string bindings working as references.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/services/accessoryAgents.js`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-regex-token-noise-guard.md`

## What Changed

- Added conservative regex-literal masking for non-Vue source token searches after string literal masking.
- Left Vue SFC handling unchanged because script and style blocks are already excluded from component-token matching.
- Added fixture coverage proving `/<RegexTokenOnlyWidget \\/>/` does not count as a rendered component reference.
- Realigned the NPC accessory agent alias guidance sentence with the newly present source guard so the full review gate can pass without weakening the test.

## Validation

- PASS: Temporary fixture reproduced the previous false negative and now reports `RegexTokenOnlyWidget.vue` as an unreferenced candidate.
- PASS: `node --test src\tests\validation-scripts.test.js` in `backend`
  - 11 tests passed.
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Reported 0 unreviewed candidates.
  - Kept the 2 reviewed dormant components: `ExtensionManager.vue` and `VirtualMessageList.vue`.
- PASS: `node --test src\tests\accessoryAgentsNpc.test.js` in `backend`
  - 2 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 258 files.
- PASS: `git diff --check`
  - No whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and final review-gate status.
- Historical failure: an earlier `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` run failed in `accessoryAgentsNpc.test.js` because the prompt wording did not match the newly added source guard. The prompt guidance was realigned and the final gate passed.

## Notes

- The worktree already contained many unrelated runtime, test, and archived-report changes. This iteration only touched the unreferenced Vue diagnostic, its validation fixture, and reporting files.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue fixture-backed diagnostic hardening only where a concrete false positive or false negative is demonstrated.
