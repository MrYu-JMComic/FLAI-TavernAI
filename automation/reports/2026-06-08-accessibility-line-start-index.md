# Vue Accessibility Diagnostic Line Start Index

Date: 2026-06-08

## Scope

- Added `buildLineStarts()` in `scripts/find-inaccessible-vue-controls.mjs`.
- Changed button and form-control violation reporting to reuse one per-file line-start index instead of counting from the start of the file for every reported violation.
- Updated `backend/src/tests/validation-scripts.test.js` source contracts so the scanner keeps the shared line-start lookup path and does not return to per-violation text scans.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 660 pass, 0 fail.
  - Frontend build: passed.

## Notes

- The diagnostic still reports no inaccessible Vue controls in the current project.
- This change is limited to scanner line-number lookup performance and keeps the emitted violation format unchanged.

## Next Recommended Task

Continue with small source-hygiene or diagnostic-script improvements while the worktree remains heavily modified by parallel frontend and backend changes.
