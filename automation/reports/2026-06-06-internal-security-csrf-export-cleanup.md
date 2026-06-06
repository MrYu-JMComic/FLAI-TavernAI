# Internal Security CSRF Export Cleanup

## Summary

- Made `sessionCookieName` internal to `backend/src/security.js`.
- Made `generateCsrfToken` and `setCsrfCookie` internal to `backend/src/services/csrf.js`.
- Kept public route-facing exports unchanged: `csrfProtection`, `csrfTokenEndpoint`, and the active security helper exports.

## Changed Files

- `backend/src/security.js`
- `backend/src/services/csrf.js`

## Validation

- `rg "export (const sessionCookieName|function generateCsrfToken|function setCsrfCookie)" backend\src -g "*.js"`: no matches
- `rg "\b(sessionCookieName|generateCsrfToken|setCsrfCookie)\b" backend\src frontend\src -g "!node_modules" -g "!dist" -g "!automation/reports/**"`: helpers remain internal-only
- `node --check src\security.js` from `backend`: passed
- `node --check src\services\csrf.js` from `backend`: passed
- `npm.cmd test` from `backend`: passed, 328 tests
- `npm.cmd run build` from `frontend`: passed

## Notes

- This only shrinks stale module API surface; runtime behavior is unchanged.
- Existing unrelated worktree changes were left untouched.

## Next Recommended Task

- Continue scanning service/module exports with low external reference counts before doing any broader refactor.
