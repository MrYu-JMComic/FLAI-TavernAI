# 2026-06-07 Duplicate Import Source Hygiene Guard

## Goal

Reduce patch-overlap drift by removing duplicate same-module import declarations and preventing them from creeping back.

## Changes

- Merged duplicate `../modules/characters.js` imports in `backend/src/routes/characters.js`.
- Merged duplicate `../modules/characters.js` imports in `backend/src/routes/conversations.js`.
- Moved `backend/src/server.js` mid-file imports for `./modules/users.js` and `./security.js` back into the top import block.
- Removed the now-exposed unused `getRegexRules` binding from `backend/src/routes/characters.js`.
- Added a source hygiene guard that fails when a source file imports the same module from multiple declarations.
- Added focused coverage proving duplicate import detection ignores comments and string fixtures.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/routes/characters.js`
- `backend/src/routes/conversations.js`
- `backend/src/server.js`
- `backend/src/tests/source-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-duplicate-import-source-hygiene-guard.md`

## Validation

- Passed: `node --test backend\src\tests\source-hygiene.test.js` (19 tests)
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (518 backend/source tests and frontend build)

## Notes

- This is an import cleanup and source hygiene guard; product behavior is unchanged.
- Existing parallel HomeView, WorldBookView, Chat, Settings, StatusBar, backend route, and report worktree changes were preserved.
