# 2026-06-07 Frontend API Error Text Fallback

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Updated `frontend/src/api.js` so normal API requests and SSE setup failures share the same HTTP error message selection.
- Preserved non-JSON error response text as truncated `rawText` instead of silently collapsing it to `{}`.
- Kept successful non-JSON responses on the existing `{}` path to avoid changing success payload shape.
- Preferred structured JSON `error` or `message` fields, retained the existing friendly 502 backend restart message, and ignored raw HTML-like bodies for user-facing fallback text.
- Made API backend retry and CSRF failure checks tolerate `null` or primitive JSON error bodies.

## Validation

- PASS: `npm.cmd run build` in `frontend`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Backend tests passed: 392/392.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report was written.

## Notes

- The worktree already contained many modified and untracked files from earlier iterations; this run only intentionally changed `frontend/src/api.js` and this report.
- Next recommended task: add focused frontend-side tests or a small test harness for API error normalization once the project has frontend test infrastructure.
