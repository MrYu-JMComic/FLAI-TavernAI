# 2026-06-07 Character Export WorldBook Order

## Backlog Item

- Add backend tests for provider settings, character CRUD, and streaming error paths.

## Changes

- Made character export choose legacy direct world books deterministically with `updated_at DESC, rowid DESC`.
- Kept the owner filter added in the previous iteration so foreign legacy rows remain excluded.
- Added route coverage proving export selects the newest owned legacy direct world book when multiple rows point at the same character.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\characterRoutes.test.js` in `backend`.
  - Tests passed: 8/8.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 408/408.
- PASS: `node scripts/check-encoding.mjs` after this report update.
  - Encoding check passed; scanned 361 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 408/408.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 361 files.

## Notes

- The ordering now matches the legacy direct fallback used by `getCharacterWorldBookId`.
- This avoids non-deterministic export output when older data contains more than one direct world book row for a character.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the export direct world book query, its focused route test, backlog, and this report.
