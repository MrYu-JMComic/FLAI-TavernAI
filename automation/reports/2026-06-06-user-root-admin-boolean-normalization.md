# User Root Admin Boolean Normalization

Date: 2026-06-06

## Summary

- Reused `normalizeBoolean` for public user `isRootAdmin` formatting.
- Reused `normalizeBoolean` when resolving authenticated session users.
- Added a regression test for string `"false"` values so malformed or legacy rows do not grant root-admin state in either public profile output or request auth context.

## Changed Files

- `backend/src/modules/users.js`
- `backend/src/security.js`
- `backend/src/tests/backend.test.js`

## Validation

- `node --check src\security.js` in `backend`: passed
- `node --check src\modules\users.js` in `backend`: passed
- `node --test src\tests\backend.test.js` in `backend`: 222 passed
- `npm.cmd test` in `backend`: 356 passed
- `git diff --check`: passed, with existing Windows line-ending warnings
- `node scripts\check-encoding.mjs`: passed
- `npm.cmd run build` in `frontend`: passed
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including backend tests and frontend build

## Notes

- Existing unrelated frontend, conversation, economy, world book, regex, character, schema, and prior report changes were preserved.
- Current worktree includes additional frontend changes from outside this iteration; they were not modified by this run.
