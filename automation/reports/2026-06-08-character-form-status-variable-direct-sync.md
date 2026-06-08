# CharacterFormView status variable direct sync

## Summary

- Normalized status blueprint payload variables through one direct loop instead of `map` plus `filter`.
- Reused the status-variable comparison result when syncing template variables, avoiding a duplicate normalized-list scan.
- Compared normalized status-variable fields directly instead of building mapped arrays and serializing each row with `JSON.stringify`.
- Cloned refreshed status-variable rows with a direct helper so changed syncs still avoid aliasing editor state.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-character-form-status-variable-direct-sync.md`

## Validation

- `node --test backend\src\tests\frontendCharacterFormView.test.js` passed: 14 tests.
- `node scripts/check-encoding.mjs` passed: 436 files scanned.
- `npm.cmd run build` passed in `frontend`.
- `npm.cmd test` passed in `backend`: 769 tests.
- `git diff --check` passed with CRLF normalization warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed.

## Next Recommended Task

- Continue the CharacterFormView audit around remaining template token split paths, especially placeholder name/property parsing.
