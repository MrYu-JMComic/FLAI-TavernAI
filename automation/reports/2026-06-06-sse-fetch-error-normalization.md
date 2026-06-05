# 2026-06-06 SSE Fetch Error Normalization

## Scope

Autonomous frontend robustness pass for streaming API calls. `streamSSE` normalized network failures on the initial fetch, but later retry fetches for dev-backend fallback and CSRF refresh could still throw raw browser errors.

## Changed Files

- `frontend/src/api.js`
  - Added `fetchSseResponse()` helper.
  - Routed the initial SSE fetch, dev backend retry, and CSRF retry through the same abort/network error handling.
  - Preserves existing abort behavior by returning `{ aborted: true }`.
  - Preserves existing user-facing network error normalization through `normalizeNetworkError()`.

## Validation

- `node scripts/check-encoding.mjs` - PASS
- `frontend`: `npm.cmd run build` - PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS
  - Encoding check PASS
  - Backend tests PASS, 228 tests
  - Frontend build PASS

## Risk Notes

- `frontend/src/api.js` already contained unrelated uncommitted changes before this run. This run only changed the `streamSSE` fetch call sites and added the helper.
- There is no frontend unit test runner in the project, so verification is build plus the full review gate.

## Next Recommended Task

Add focused frontend tests for `api.js` streaming behavior if a frontend test harness is introduced.
