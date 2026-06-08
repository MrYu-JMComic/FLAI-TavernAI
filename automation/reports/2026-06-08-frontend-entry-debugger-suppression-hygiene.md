# Frontend Entry Debugger Suppression Hygiene

## Summary

Extended source hygiene checks so `frontend/index.html` inline scripts are covered by debugger-statement and quality-suppression comment guards, matching the existing frontend entry console-output coverage.

## Changed Files

- `backend/src/tests/source-hygiene.test.js`
  - Added `frontend/index.html` to the combined source-and-entry hygiene list.
  - Updated debugger and quality-suppression final assertions to include the frontend entry file.
  - Added focused fixture coverage for inline-script debugger statements and suppression comments.
- `automation/backlog.md`
  - Recorded this completed iteration.

## Validation

- PASS: `node --test backend\src\tests\source-hygiene.test.js`
  - Result: 34 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend test suite passed: 681 tests.
  - Frontend build passed.
  - Git status check completed.

## Next Recommended Task

Keep subsequent cleanup narrow while the worktree remains heavily dirty; prefer source-hygiene blind spots or diagnostic-contract fixes with clear evidence.
