# 2026-06-07 Character Export WorldBook Ownership

## Backlog Item

- Add backend tests for provider settings, character CRUD, and streaming error paths.

## Changes

- Hardened character export so direct legacy world book lookup requires `world_books.user_id` to match the exported character owner.
- Added route coverage proving foreign legacy direct world book rows are omitted from exported character JSON.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\characterRoutes.test.js` in `backend`.
  - Tests passed: 7/7.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 407/407.
- PASS: `node scripts/check-encoding.mjs` after this report update.
  - Encoding check passed; scanned 360 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 407/407.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 360 files.

## Notes

- This follows the world book ownership hardening series by closing an export-side legacy direct binding leak.
- The `worldBookId` empty-string save path was inspected but left unchanged because the current Vue form manages multi-book links through dedicated character world book endpoints.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the export ownership filter, its focused route test, backlog, and this report.
