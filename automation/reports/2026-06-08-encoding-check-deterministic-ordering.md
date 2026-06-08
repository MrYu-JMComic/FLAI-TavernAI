# Autonomous Iteration Report - 2026-06-08 - Encoding Check Deterministic Ordering

## Summary

Made the UTF-8 encoding checker traverse files in deterministic code-unit order
so mojibake failure output does not depend on host filesystem directory order.

## Changed Files

- `scripts/check-encoding.mjs`
  - Added a local `comparePathText` comparator.
  - Sorted directory entries before recursive traversal.
- `backend/src/tests/validation-scripts.test.js`
  - Added a structural guard against `localeCompare` in the encoding checker.
  - Extended the mojibake fixture to assert stable multi-file failure ordering.
- `automation/backlog.md`
  - Recorded this completed iteration.

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node --check scripts\check-encoding.mjs`
- PASS: `rg -n "localeCompare" scripts backend\src\tests\validation-scripts.test.js`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- Existing unrelated dirty worktree files were preserved.
- The review gate reported 621 backend tests passing and the frontend Vite
  production build passing.
- The remaining `localeCompare` matches in the focused search are regression
  assertions inside `backend/src/tests/validation-scripts.test.js`.

## Next Recommended Task

Audit frontend business sorting separately and only change locale-aware
comparisons when they are not intentional UI behavior.
