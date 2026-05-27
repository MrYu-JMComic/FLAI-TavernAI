# Home Virtual List Spacing Fix - 2026-05-26

## Goal

Reduce the oversized vertical spacing in the mobile home character list by making the virtualized rows track their real rendered height.

## Changes

- Updated `frontend/src/views/HomeView.vue`.
- Added TanStack Virtual `measureElement` support for character rows.
- Added `data-index` and a function ref to each virtual row so row heights are measured after render.
- Removed the fixed virtual row height from the inline style and kept row spacing as measured padding.

## Validation

- `frontend`: `npm.cmd run build` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` could not run because `scripts/review-gate.ps1` is not present.
- In-app browser automation could not complete because the local browser runtime failed to initialize with `windows sandbox failed: setup refresh failed`. Manual browser refresh should pick up Vite HMR or the running dev server.

## Safety

- Frontend-only change.
- Did not touch `backend/data`, `backend/uploads`, `.env`, `node_modules`, or generated build output intentionally.

## Next Recommended Task

Restore the missing `scripts/review-gate.ps1`, then do a visual pass over the home list at narrow and desktop widths.
