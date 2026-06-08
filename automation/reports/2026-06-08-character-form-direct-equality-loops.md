# CharacterFormView direct equality loops

## Summary

- Replaced `sameListItems` `.every()` comparison with a direct indexed loop.
- Replaced `samePlainValue` array and object-key `.every()` comparisons with direct loops.
- Updated CharacterFormView source coverage to keep option-list and AI process reference checks on direct-loop paths.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-character-form-direct-equality-loops.md`

## Validation

- `node --test backend\src\tests\frontendCharacterFormView.test.js` passed: 13 tests.
- `node scripts/check-encoding.mjs` passed: 429 files scanned.
- `npm.cmd run build` passed in `frontend`.
- `npm.cmd test` passed in `backend`: 765 tests.
- `git diff --check` passed with CRLF normalization warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed.

## Next Recommended Task

- Continue the CharacterFormView audit around world-book selection updates and status-variable payload normalization, which still include callback-heavy map/filter paths.
