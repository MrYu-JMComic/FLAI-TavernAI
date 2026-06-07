# Review gate unreferenced Vue diagnostic

Date: 2026-06-07

## Scope

Wired the unreferenced Vue component scanner into the review gate as a non-blocking diagnostic.

## Changed files

- `scripts/review-gate.ps1`
  - Added `[2/5]` unreferenced Vue component diagnostics after encoding checks.
  - Runs `node scripts/find-unreferenced-vue-components.mjs`.
  - Does not add scanner findings or scanner non-zero status to `$failures`, keeping the step advisory rather than destructive.
  - Renumbered later review-gate stages from four to five.
- `backend/src/tests/validation-scripts.test.js`
  - Added assertions that the review gate invokes the scanner.
  - Added a guard that the scanner diagnostic is not wired as a failure item.
- `automation/reports/2026-06-07-review-gate-unreferenced-vue-diagnostic.md`
  - Records this run.

## Validation

- PASS: `node scripts/find-unreferenced-vue-components.mjs`.
  - Reported 5 candidate components.
- PASS: `node --test src\tests\validation-scripts.test.js` from `backend`.
  - 4/4 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - New `[2/5]` unreferenced Vue component diagnostic ran and reported 5 candidates.
  - Backend tests passed: 391/391.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 320 files.

## Safety decision

The scanner remains non-blocking in the review gate so that possible dynamic imports, planned feature work, or dirty-worktree interactions do not cause false CI failures. Deletion decisions still require explicit review.

## Next recommended task

Pick one scanner candidate and verify its feature ownership before deciding whether it should be rewired, documented as dormant, or removed with explicit approval.
