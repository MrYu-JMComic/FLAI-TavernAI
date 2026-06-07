# Unreferenced Vue scanner test guard

Date: 2026-06-07

## Scope

Added a focused backend validation test for the unreferenced Vue component scanner script.

## Changed files

- `backend/src/tests/validation-scripts.test.js`
  - Added helpers for running repository Node scripts from tests.
  - Added a guard that verifies `scripts/find-unreferenced-vue-components.mjs`:
    - exits successfully by default,
    - emits parseable `--json` output,
    - reports component candidate paths under `frontend/src/components`,
    - keeps candidate `references` empty,
    - exits with status 1 under `--fail-on-candidates` only when candidates exist.
- `automation/reports/2026-06-07-unreferenced-vue-scanner-test-guard.md`
  - Records this run.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js` from `backend`.
  - 4/4 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding checks passed.
  - Backend tests passed: 391/391.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 319 files.

## User change safety

The worktree already had many modified and untracked files. This run only updated the validation script test file and added this report.

## Next recommended task

Run the scanner before any component deletion decision, then pick one candidate and verify whether it is intentionally dormant, should be rewired, or can be removed with explicit approval.
