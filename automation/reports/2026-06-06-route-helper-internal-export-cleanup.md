# Route Helper Internal Export Cleanup

## Summary

- Removed public exports from route helper functions that are only used inside `backend/src/routes/helpers.js`.
- Kept `mergeConversationAppearance` and `getConversationUsage` as private module helpers.
- Preserved behavior while reducing the shared route helper module's public surface.

## Changed Files

- `backend/src/routes/helpers.js`

## Validation

- `rg "mergeConversationAppearance|getConversationUsage|withConversationUsage|toConversation|toMessage|parseJson|normalizeIdList|getChatProviderSettingsFromContext" -n backend\src frontend\src`: confirmed `mergeConversationAppearance` and `getConversationUsage` have no external imports.
- `node --check src\routes\helpers.js` from `backend`: passed
- `node --check src\routes\conversations.js` from `backend`: passed
- `node --test src\tests\routeHelpers.test.js` from `backend`: passed, 9 tests
- `npm.cmd test` from `backend`: passed, 337 tests
- `npm.cmd run build` from `frontend`: passed

## Notes

- This is an API surface cleanup only; runtime behavior is unchanged.
- Existing unrelated worktree changes were preserved.

## Next Recommended Task

- Continue scanning shared modules for exports that can be made private only when reference searches prove no external users.
