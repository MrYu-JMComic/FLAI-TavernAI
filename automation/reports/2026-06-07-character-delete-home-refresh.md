# Character Delete Home Refresh

## Summary

- Fixed the home character list staying stale after deleting a character from the edit page.
- Character list requests now use `cache: no-store`, so returning home after delete fetches fresh data instead of a short-lived cached list response.

## Changed Files

- `frontend/src/api.js`

## Validation

- `node scripts/check-encoding.mjs` - passed
- `cd frontend && npm run build` - passed

## Notes

- Existing unrelated working tree changes were preserved.
- This mirrors the world book list cache fix used for delete/list refresh behavior.

## Next Recommended Task

- Consider centralizing no-cache behavior for mutation-sensitive list endpoints.
