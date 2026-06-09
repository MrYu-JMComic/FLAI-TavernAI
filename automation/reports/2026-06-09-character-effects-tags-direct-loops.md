# 2026-06-09 - Character Effects And Tags Direct Loops

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-character-effects-tags-direct-loops.md`

## Summary

- Replaced CharacterFormView advanced status-effect filtering with a direct helper loop.
- Replaced selected character tag-name mapping during form normalization with a direct helper loop.
- Preserved existing form state shape while reducing callback work during character load and advanced settings normalization.

## Coverage

- Added a source guard requiring advanced effects to flow through `collectAllowedStatusEffects()`.
- Added a source guard requiring selected tags to flow through `collectCharacterTagNames()`.
- Added regression checks preventing the previous `parsed.effects.filter()`, allowed-effect `includes()`, and `characterTags.map()` paths from returning.

## Validation

- PASS: `node --test src/tests/frontendCharacterFormView.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing active chat and character normalization paths for stale async cleanup and callback-heavy computed work.
