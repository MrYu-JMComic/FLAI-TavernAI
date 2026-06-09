# 2026-06-09 - Character Status Template Token Parser

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-character-status-template-token-parser.md`

## Summary

- Routed status template usage parsing through `parseStatusTemplateToken()`.
- Routed inferred status variable name parsing through the same shared helper.
- Removed the remaining `token.split('.')` array allocations from CharacterFormView status template parsing.

## Coverage

- Added CharacterFormView source guards requiring the shared parser in both usage and inference paths.
- Added regression checks preventing `token.split('.')` and `propertyParts` parsing from returning.

## Validation

- PASS: `node --test src/tests/frontendCharacterFormView.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing backend list helpers that still build transient id arrays in hot character/image paths.
