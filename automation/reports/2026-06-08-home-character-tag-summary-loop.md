# Home Character Tag Summary Loop

## Backlog item

- Reduce redundant allocation in HomeView refresh equality checks while preserving the existing character-card tag behavior.

## Changed files

- `frontend/src/views/HomeView.vue`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-home-character-tag-summary-loop.md`

## What changed

- Replaced `normalizeCharacterTagList(...tags.map(...))` in `sameCharacterSummary` with direct tag-summary comparison helpers.
- Preserved the existing priority where populated `characterTags` are compared as structured tags and fallback `tags` are compared by name.
- Updated HomeView source coverage so refresh equality cannot regress to mapped fallback arrays.

## Validation

- Focused HomeView source coverage passed:
  - `node --test backend\src\tests\frontendHomeView.test.js --test-name-pattern "HomeView (compares character tag summaries|preserves unchanged character|builds card tag previews)"`
- Encoding check passed:
  - `node scripts\check-encoding.mjs`
- Full review gate passed:
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next recommended task

- Review the remaining HomeView `providerLabel` two-field join only if another HomeView cleanup is selected; it is low risk but lower impact than refresh-list equality work.
