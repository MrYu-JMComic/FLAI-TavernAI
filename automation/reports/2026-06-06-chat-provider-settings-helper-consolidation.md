# Chat Provider Settings Helper Consolidation

## Summary

- Added shared `getChatProviderSettingsFromContext` in `backend/src/routes/helpers.js`.
- Updated `backend/src/server.js` to use the shared helper for its route context `getChatProviderSettings`.
- Updated `backend/src/routes/conversations.js` to use the shared helper instead of a duplicated local implementation.
- Preserved compatibility with direct route tests that still provide `providerWithSecret`, `getProviderRow`, and `hasUsableProvider` instead of a prebuilt `getChatProviderSettings`.

## Changed Files

- `backend/src/routes/helpers.js`
- `backend/src/routes/conversations.js`
- `backend/src/server.js`

## Validation

- `rg "function getChatProviderSettings|providerWithSecret\(ctx\.getProviderRow|ctx\.getProviderRow\(|请先在用户页保存 API Key / SK，再开始真实对话" backend\src\routes\conversations.js backend\src\server.js`: only the server thin wrapper remains
- `rg "getChatProviderSettingsFromContext" backend\src\routes\helpers.js backend\src\routes\conversations.js backend\src\server.js`: shared helper wiring present
- `node --check src\routes\helpers.js` from `backend`: passed
- `node --check src\routes\conversations.js` from `backend`: passed
- `node --check src\server.js` from `backend`: passed
- `npm.cmd test` from `backend`: passed, 328 tests
- `npm.cmd run build` from `frontend`: passed

## Notes

- An initial backend test run exposed the missing helper in direct route test contexts; the final implementation keeps those contexts compatible while still consolidating the provider readiness logic.
- Existing unrelated worktree changes were left untouched.

## Next Recommended Task

- Continue checking route context helpers for duplicated fallback logic before broader refactors.
