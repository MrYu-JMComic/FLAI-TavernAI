# 2026-06-07 Character Export Linked WorldBook

## Backlog Item

- Add backend tests for provider settings, character CRUD, and streaming error paths.

## Changes

- Updated character export to prefer the first junction-linked world book before falling back to legacy direct `world_books.character_id` rows.
- Kept linked world book selection ordered by `order_index`, link creation time, and row insertion, matching `getCharacterWorldBookId`.
- Added route coverage proving linked world books are exported ahead of legacy direct fallback rows.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\characterRoutes.test.js` in `backend`.
  - Tests passed: 9/9.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 409/409.
- PASS: `node scripts/check-encoding.mjs` after this report update.
  - Encoding check passed; scanned 362 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 409/409.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 362 files.

## Notes

- This fixes an export mismatch with the current Vue character form, which stores selected world books through `character_world_books`.
- Existing legacy direct export behavior remains available as fallback when no linked world book exists.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the export world book selection, its focused route test, backlog, and this report.
