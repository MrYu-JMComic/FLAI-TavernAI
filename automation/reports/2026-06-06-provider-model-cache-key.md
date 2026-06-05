# 2026-06-06 Provider Model Cache Key Robustness

## Scope

Autonomous robustness pass for provider settings/model listing. The working tree already contained many unrelated modified and untracked files, so this run only touched the provider model cache and its regression coverage.

## Changed Files

- `backend/src/services/providers.js`
  - Added a short SHA-256 API key fingerprint to the provider model cache key.
  - Avoids storing the raw API key in memory cache keys.
  - Prevents stale model lists when a user changes API keys for the same provider/base URL.
- `backend/src/tests/backend.test.js`
  - Added `provider model cache refreshes when API key changes`.
  - Verifies the same key uses cache and a different key performs a fresh `/models` request.

## Validation

- `node scripts/check-encoding.mjs` - PASS
- `backend`: `npm.cmd test` - PASS, 228 tests
- `frontend`: `npm.cmd run build` - PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS

## Notes

- The frontend build still reports the existing Vite warning for a large `StatusBar` chunk over 500 kB. This run did not alter frontend bundling because the selected fix was backend-scoped and low risk.
- Existing dirty worktree state remains; unrelated files were not reverted or reformatted.

## Next Recommended Task

Investigate the `StatusBar` bundle warning and consider code splitting or dependency isolation if it can be done without changing runtime behavior.
