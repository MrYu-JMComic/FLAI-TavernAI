# Autonomous Report: Unreferenced Vue Scanner Path Coverage

## Summary

Improved the unreferenced Vue component diagnostic so it can recognize more legitimate component references before reporting deletion candidates. This keeps the current review workflow conservative while reducing future false positives from dynamic import patterns.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
  - Added `--project-root` support for fixture-based validation.
  - Added path-aware reference extraction from string literals.
  - Resolved relative component paths, `@/` aliases, `src/` paths, and `/src/` paths.
  - Added `import.meta.glob`-style `.vue` glob matching.
- `backend/src/tests/validation-scripts.test.js`
  - Added a temporary fixture test proving direct, alias, `/src/`, query-suffixed, and globbed component references are not reported as unused.

## Validation

- PASS: `node scripts/find-unreferenced-vue-components.mjs`
  - Still reports the same 5 candidates for manual review.
- PASS: `node --test src\tests\validation-scripts.test.js`
  - 5/5 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue diagnostic ran as non-blocking.
  - Backend tests passed: 392/392.
  - Frontend build passed.
- PASS: post-report `node scripts/check-encoding.mjs`
  - Scanned 323 files after this report was added.

## Remaining Attention

The scanner still reports these components as candidates and they should not be deleted without manual ownership verification:

- `frontend/src/components/CharacterImagePanel.vue`
- `frontend/src/components/ExtensionManager.vue`
- `frontend/src/components/TalentBadge.vue`
- `frontend/src/components/TalentRollDialog.vue`
- `frontend/src/components/VirtualMessageList.vue`

Recommended next task: inspect one candidate component at a time and record whether it is dormant, intentionally reserved, or should be wired into a reachable flow.
