# 2026-06-19 Settings structure reorganization

## Summary

Reorganized the settings experience in a small front-end-only step. The personal settings page now has the same clear section navigation pattern as the extensions page, and provider advanced model fields are grouped into a collapsed native details block instead of sitting in the main form flow.

## Changed files

- `frontend/src/views/SettingsView.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendSettingsView.test.js`
- `automation/reports/2026-06-19-settings-structure-reorganization.md`

## Validation

- Passed: `cd backend && node --test src/tests/frontendSettingsView.test.js`
- Passed: `node scripts/find-inaccessible-vue-controls.mjs --json`
  - Result: `violations: []`
- Passed: `cd frontend && npm run build`
  - Result: Vite build completed successfully.
- Passed: `node scripts/check-encoding.mjs`
  - Result: scanned 683 files; no common Chinese mojibake or replacement-character markers found.
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
  - Result: PASS; backend tests reported 967 passed, and frontend build completed successfully.

## Notes

- No backend API, database schema, dependency, environment, upload, local data, or generated output change was required.
- Cleanup requirement applied: the old extension-only section scroll helpers were removed after introducing shared settings section helpers used by both personal and extension navigation.
- Existing unrelated `frontendCharacterFormView` test/report worktree changes were preserved and not edited by this iteration.
