# Home List Compare Loop

## Backlog item

- Reduce callback overhead in HomeView refreshed-list equality checks while preserving reference stability for unchanged character and tag lists.

## Changed files

- `frontend/src/views/HomeView.vue`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-home-list-compare-loop.md`

## What changed

- Replaced the shared `sameListItems` `Array.every` callback with a direct index loop that exits on the first mismatch.
- Updated HomeView source coverage to assert the direct loop contract and guard against reintroducing `currentItems.every(...)`.
- Kept the existing no-change reference preservation behavior for refreshed character and tag lists.

## Validation

- Focused HomeView source coverage passed:
  - `node --test backend\src\tests\frontendHomeView.test.js --test-name-pattern "HomeView preserves unchanged character and tag list references"`
- Encoding check passed:
  - `node scripts\check-encoding.mjs`
- Full review gate passed:
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
- Diff safety checks passed:
  - `git diff --check`
  - `git diff --cached --check`
  - `git status --short -- backend/data backend/uploads .env .env.local .env.development .env.production`

## Next recommended task

- Review the remaining HomeView formatting helpers only if another HomeView cleanup is selected; avoid widening this iteration beyond refreshed-list equality.
