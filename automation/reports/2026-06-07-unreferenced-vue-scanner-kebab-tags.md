# Unreferenced Vue scanner kebab tag matching

Date: 2026-06-07

## Scope

Reduced false-positive risk in the unreferenced Vue component scanner.

## Changed files

- `scripts/find-unreferenced-vue-components.mjs`
  - Added PascalCase-to-kebab-case conversion for component names.
  - Added reference tokens for kebab-case template tags, dynamic `is=` bindings, and global `.component(...)` registration names.
- `backend/src/tests/validation-scripts.test.js`
  - Added guard assertions that the scanner keeps kebab-case matching support.
- `automation/reports/2026-06-07-unreferenced-vue-scanner-kebab-tags.md`
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
  - Encoding check passed: scanned 321 files.

## Safety decision

No components were deleted. This change only improves scanner recall for common Vue usage forms so future cleanup decisions are less likely to rely on a false-positive candidate.

## Next recommended task

Use the scanner output to manually verify one candidate's ownership path before any removal or rewiring decision.
