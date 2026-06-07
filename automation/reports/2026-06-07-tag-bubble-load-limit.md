# 2026-06-07 Tag Bubble Load Limit

## Summary

- Changed the extensions tag management UI from a vertical list to a wrapping bubble cloud.
- Added a persisted "max load" control for tags, defaulting to 80 and clamped to 500.
- Wired `/api/tags?limit=N` through the frontend API, route layer, and tag module query.
- Added focused backend coverage for deterministic tag list limiting.

## Changed Files

- `backend/src/modules/tags.js`
- `backend/src/routes/tags.js`
- `backend/src/tests/tagListLimit.test.js`
- `frontend/src/api.js`
- `frontend/src/views/SettingsView.vue`
- `frontend/src/styles.css`

## Validation

- Passed: `npm.cmd run build` in `frontend`
- Passed: `node scripts/check-encoding.mjs`
- Passed: `node --test src\tests\tagListLimit.test.js` in `backend`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
- Note: an earlier standalone `npm.cmd test` run reported transient `mods` failures, but the subsequent review gate reran the full backend suite successfully.

## Next Recommended Task

- Add a small frontend interaction test around the tag max-load control if a browser test harness is introduced.
