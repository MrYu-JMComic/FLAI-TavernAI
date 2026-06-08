# 2026-06-08 Chat Model Auth Context Key

## Summary

Aligned the quick chat model switcher's provider context key with provider model cache auth availability so API-key availability changes invalidate stale model refresh and save contexts.

## Changed Files

- `frontend/src/components/chat/ChatModelSwitcher.vue`
  - Added `Boolean(provider.apiKey || provider.apiKeySet)` to the model switcher context key so open-state draft/search reset follows auth availability changes.
- `frontend/src/views/ChatView.vue`
  - Added the same auth-availability signal to quick model refresh/save guards so stale in-flight model operations from a previous auth context are ignored.
- `backend/src/tests/frontendChatModelSwitcher.test.js`
  - Added source coverage for the auth-aware quick model context keys.

## Validation

- `node --test src/tests/frontendChatModelSwitcher.test.js` in `backend` passed.
- `node ..\scripts\check-encoding.mjs` in `backend` passed.
- `npm test` in `backend` passed.
- `npm run build` in `frontend` passed.

## Notes

- Existing unrelated working-tree changes were preserved and not edited: `frontend/src/api.js`, `backend/src/tests/frontendApi.test.js`, `automation/backlog.md`, and `automation/reports/2026-06-08-frontend-csrf-cookie-exact-scan.md`.

## Next Recommended Task

Review remaining quick-setting panels for context keys that omit auth, route, or feature-availability inputs used by their backing caches or async guards.
