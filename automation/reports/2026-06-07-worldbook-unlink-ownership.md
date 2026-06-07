# 2026-06-07 WorldBook Unlink Ownership

## Backlog Item

- Add backend tests for provider settings, character CRUD, and streaming error paths.

## Changes

- Added an optional `userId` ownership boundary to `unlinkWorldBookFromCharacter`.
- Updated the character world book unlink route to pass the authenticated user ID.
- Added route coverage proving legacy cross-owner junction rows are not deleted through a character owner request.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\characterRoutes.test.js src\tests\worldBookOwnershipRoutes.test.js` in `backend`.
  - Tests passed: 10/10.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 406/406.
- PASS: `node scripts/check-encoding.mjs` after this report update.
  - Encoding check passed; scanned 359 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 406/406.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 359 files.

## Notes

- The legacy three-argument helper behavior is preserved for existing internal callers.
- The authenticated route now requires both the character and world book to belong to the current user before deleting a junction row.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the unlink ownership guard, its focused route test, backlog, and this report.
