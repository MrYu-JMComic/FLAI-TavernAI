# 2026-06-19 Character form autosave draft

## Summary

Implemented Phase 1 character form autosave drafts from the master UX plan. Editable character forms now keep a scoped local draft for new characters or the current edit target, surface a compact recovery bar when a saved draft exists, preserve linked world book selections, and clear obsolete local drafts after save or delete.

## Changed files

- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/reports/2026-06-19-character-form-autosave-draft.md`

## Validation

- Passed: `cd backend && node --test src/tests/frontendCharacterFormView.test.js`
- Passed: `cd frontend && npm run build`
  - Includes prebuild encoding check.
- Passed: `node scripts/check-encoding.mjs`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
  - Result: 960 backend tests passed.

## Notes

- No backend API, database schema, dependency, environment, upload, local data, or generated output change was required.
- The autosave path reuses the existing `toPayload()` and world book selection state instead of adding a parallel form serializer.
- Local draft writes are blocked while an older pending draft is awaiting restore or discard, avoiding accidental overwrite of recoverable work.
