# Sanitize Message Stale Helper Cleanup

## Summary

- Removed unused `sanitizeMessagePayload` from `backend/src/services/sanitize.js`.
- Removed its now-unused private `sanitizeMessage` helper.
- Kept the active sanitize APIs used by routes and tests: `sanitizeText`, `sanitizeRichText`, `sanitizeFields`, and `sanitizeCharacterPayload`.

## Changed Files

- `backend/src/services/sanitize.js`

## Validation

- `rg "sanitizeMessage" backend\src frontend\src -g "!node_modules" -g "!dist" -g "!automation/reports/**"`: no matches
- `rg "sanitizeMessagePayload" backend\src frontend\src -g "!node_modules" -g "!dist" -g "!automation/reports/**"`: no matches
- `node --test src\tests\sanitize.test.js` from `backend`: passed, 1 test
- `npm.cmd test` from `backend`: passed, 328 tests
- `npm.cmd run build` from `frontend`: passed

## Notes

- Existing unrelated worktree changes were left untouched.
- This is a dead-code cleanup only; no active route behavior was changed.

## Next Recommended Task

- Continue stale export review in a narrow backend helper module, such as `backend/src/routes/helpers.js` or `backend/src/modules/users.js`, with reference checks before deleting anything.
