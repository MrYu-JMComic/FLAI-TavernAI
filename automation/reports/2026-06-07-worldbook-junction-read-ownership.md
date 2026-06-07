# 2026-06-07 WorldBook Junction Read Ownership

## Backlog Item

- Add backend tests for provider settings, character CRUD, and streaming error paths.

## Changes

- Hardened `getWorldBook` so `linkedCharacters` only includes characters owned by the world book owner.
- Hardened `listCharacterWorldBooks` so legacy cross-owner junction rows do not expose another user's world book through a character.
- Extended `backend/src/tests/worldBookOwnershipRoutes.test.js` with a legacy dirty junction row case.

## Validation

- PASS: `node --test src\tests\worldBookOwnershipRoutes.test.js` in `backend`.
  - Tests passed: 4/4.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 405/405.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed; scanned 358 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 405/405.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report update.
  - Encoding check passed; scanned 358 files.

## Notes

- Valid same-owner junction links continue to work and remain ordered by link order and insertion time.
- This is a read-side hardening follow-up to the character binding ownership guard.
- The worktree already contained many modified and untracked files from earlier iterations; this run intentionally touched only world book read filtering, its focused test, backlog, and this report.
