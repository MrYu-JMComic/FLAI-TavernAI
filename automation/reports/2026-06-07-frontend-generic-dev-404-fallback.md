# 2026-06-07 Frontend Generic Dev 404 Fallback

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Split dev backend fallback blocking from general readable error extraction so specific plain-text API errors are preserved while generic dev-server 404 text still falls back.
- Added focused frontend API coverage for generic `Cannot GET /api/...` and `Cannot POST /api/...` fallback behavior across normal requests and assistant SSE requests.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `node --test src\tests\frontendApi.test.js` in `backend`.
  - Tests passed: 15/15.
- PASS: `npm.cmd test` in `backend`.
  - Encoding pretest passed.
  - Backend tests passed: 425/425.
- PASS: `npm.cmd run build` in `frontend`.
  - Encoding prebuild passed.
  - Frontend build passed.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed; scanned 380 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 425/425.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 380 files.

## Notes

- This guards against a negative interaction from preserving plain-text API 404s: generic dev-server 404 bodies no longer prevent the intended fallback to port 3001.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only the focused frontend API module, its test, backlog, and this report.
