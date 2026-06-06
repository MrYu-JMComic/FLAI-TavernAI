# Server Route Helper Import Cleanup

## Summary

- Removed stale route-helper imports from `backend/src/server.js` that were left behind after route modularization:
  - `getRegexRulesForCharacter`
  - `setCharacterTags`
  - `getConversationAppearance`
  - `normalizeAdvancedSettings`
  - `mergeAdvancedSettings`
  - `summarizeUsageSnapshots`
- Removed the now-unused local `parseJson` helper from `backend/src/server.js`.
- Kept active route context helpers such as `withWorldBookId`, `withCharacterTags`, `getProviderRow`, and `getChatProviderSettings`.

## Changed Files

- `backend/src/server.js`

## Validation

- `rg "\b(getRegexRulesForCharacter|setCharacterTags|getConversationAppearance|normalizeAdvancedSettings|mergeAdvancedSettings|summarizeUsageSnapshots|parseJson)\b" backend\src\server.js`: no matches
- `node --check src\server.js` from `backend`: passed
- `npm.cmd test` from `backend`: passed, 328 tests
- `npm.cmd run build` from `frontend`: passed

## Notes

- Existing unrelated worktree changes were left untouched.
- `backend/src/server.js` already had unrelated diffs before this cleanup; this iteration only removed stale imports and one unused local helper.

## Next Recommended Task

- Continue narrow modularization cleanup by checking route context helpers for duplicate implementations that can be consolidated without changing behavior.
