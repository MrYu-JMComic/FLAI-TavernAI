# 2026-06-07 Frontend SSE Error Message

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Updated the shared SSE error path in `frontend/src/api.js` to use the existing structured API error-message helper.
- Streamed assistant errors now accept either `error` or `message` fields, matching the normal `apiRequest` error handling path.
- Recorded this iteration in `automation/backlog.md`.

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding prebuild passed.
  - Frontend build passed.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed; scanned 365 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 409/409.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this validation update.
  - Encoding check passed; scanned 365 files.

## Notes

- This is a narrow frontend API robustness fix; no individual view behavior was changed.
- The worktree already contained many unrelated modified and untracked files; this run intentionally touched only `frontend/src/api.js`, backlog, and this report.
