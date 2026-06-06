# Home Mobile Filter Row Report

## Summary

- Changed the mobile home filter bar into a single-row control with search on the left and a compact sort button on the right.
- Kept the desktop sort select intact, while the mobile sort button cycles through created time, recent use, and name sorting.
- Adjusted the mobile sticky offset so the filter bar sits below the top navigation instead of slipping underneath it.
- Added transitions and press/focus feedback for smoother layout and interaction changes.

## Changed Files

- `frontend/src/views/HomeView.vue`
- `frontend/src/styles.css`
- `automation/reports/2026-06-06-home-mobile-filter-row.md`

## Validation

- `npm.cmd run build` in `frontend`: passed.
- `node scripts/check-encoding.mjs`: passed.

## Notes

- The working tree already contained many unrelated modified, deleted, and untracked files before this iteration. This run only intentionally changed the home filter controls and added this report.

## Next Recommended Task

- Check the sticky filter at 360px, 414px, and 614px viewport widths to tune the sticky top offset if the top navigation height changes.
