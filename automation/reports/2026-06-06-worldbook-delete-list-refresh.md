# World Book Delete List Refresh

## Summary

- Fixed world book deletion so the deleted book is removed from the visible list immediately after the delete request succeeds.
- Disabled browser caching for the world book list request to avoid reloading stale list data right after mutations.
- Cleared the active detail book when the deleted item is the current detail view.

## Changed Files

- `frontend/src/api.js`
- `frontend/src/views/WorldBookView.vue`

## Validation

- `node scripts/check-encoding.mjs` - passed
- `cd frontend && npm run build` - passed

## Notes

- The working tree already contains many unrelated frontend/backend changes; this run only targeted the world book delete/list refresh path.

## Next Recommended Task

- Consider adding a small frontend/API regression test around world book list cache behavior after create/update/delete mutations.
