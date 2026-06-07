# 2026-06-07 Backend Unused Named Import Prune

## Goal

Remove backend import drift left by prior patches without changing runtime behavior.

## Changes

- Removed unused named import bindings from backend modules and route files.
- Added a backend source hygiene check that catches named imports with no source references.
- Kept the check out of frontend SFC imports so Vue template component bindings are not misclassified.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/modules/characterImages.js`
- `backend/src/routes/branches.js`
- `backend/src/routes/characters.js`
- `backend/src/routes/conversations.js`
- `backend/src/routes/mods.js`
- `backend/src/routes/presets.js`
- `backend/src/routes/settings.js`
- `backend/src/tests/source-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-backend-unused-named-import-prune.md`

## Validation

- Passed: `node --test backend\src\tests\source-hygiene.test.js`
- Passed: `node scripts\check-encoding.mjs`
- Passed: `git diff --check` with LF/CRLF conversion warnings only and no whitespace errors.
- Passed: `git diff --cached --check`
- Passed: `npm run build` in `frontend`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (503 backend/source tests and frontend build)

## Notes

- This is a source hygiene cleanup only; no route handlers, module exports, database logic, or API behavior changed.
- Parallel Chat and Settings worktree changes were present during final validation and were preserved.
