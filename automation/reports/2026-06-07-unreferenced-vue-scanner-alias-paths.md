# Unreferenced Vue scanner alias path matching

Date: 2026-06-07

## Scope

Reduced false-positive risk in the unreferenced Vue component scanner by broadening path import matching.

## Changed files

- `scripts/find-unreferenced-vue-components.mjs`
  - Added extensionless component path tokens.
  - Added `@/components/...` alias-style path tokens with and without `.vue`.
  - Kept existing relative path and kebab-case component tag matching.
- `backend/src/tests/validation-scripts.test.js`
  - Added guard assertions for extensionless and `@/` alias token support.
- `automation/reports/2026-06-07-unreferenced-vue-scanner-alias-paths.md`
  - Records this run.

## Validation

- PASS: `node scripts/find-unreferenced-vue-components.mjs`.
  - Still reports 5 candidate components.
- PASS: `node --test src\tests\validation-scripts.test.js` from `backend`.
  - 4/4 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Unreferenced Vue diagnostic reported 5 candidate components.
  - Backend tests passed: 391/391.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 322 files.

## Safety decision

No components were deleted. This only improves scanner recall for common import styles so future cleanup decisions are less likely to rely on an incomplete static scan.

## Next recommended task

Manually verify one remaining candidate's feature path before any removal or rewiring decision.
