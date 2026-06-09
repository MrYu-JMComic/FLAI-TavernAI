# 2026-06-09 - Home Sort And Tag Direct Lookups

## Changed Files

- `frontend/src/views/HomeView.vue`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-home-sort-tag-direct-lookups.md`

## Summary

- Replaced HomeView sort-option lookup and sort cycling callbacks with direct helper scans.
- Replaced selected hot-tag lookup with a direct tag-name helper.
- Preserved existing fallback behavior for unknown sort values and missing selected tags while reducing callback work in active Home controls.

## Coverage

- Added source guards requiring current sort, next sort, and selected hot tag lookups to use direct helpers.
- Added regression checks preventing `sortOptions.find()`, `sortOptions.findIndex()`, and `tags.value.find()` from returning.

## Validation

- PASS: `node --test src/tests/frontendHomeView.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing active character form normalization paths for spread-heavy copies and stale UI state writes.
