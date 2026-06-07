# 2026-06-07 Frontend Root API Dev Fallback

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Added an `isApiPath` helper so dev-backend fallback recognizes both `/api` and `/api/...` paths.
- Allowed raw generic dev-server 404 text such as `Cannot GET /api` to use the same fallback path as nested API routes.
- Added regression coverage for root `/api` generic dev-server 404 fallback.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 23/23.
- PASS: `node scripts/check-encoding.mjs`.
  - Scanned 388 files; no common Chinese mojibake markers found.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic reported no unreviewed candidates.
  - Vue control accessibility diagnostic reported no inaccessible controls.
  - Backend tests passed: 433/433.
  - Frontend build passed.
  - Git status check reported the existing dirty worktree.

## Notes

- Structured JSON 404 errors still block fallback; this only extends raw dev-server fallback text handling.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, frontend API tests, backlog, and this report.
