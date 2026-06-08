# Unreferenced Vue Component Lookup Names

Date: 2026-06-08

## Scope

- Refactored `scripts/find-unreferenced-vue-components.mjs` so component tag and `<component is>` pattern builders share one `componentLookupNames()` helper.
- Replaced the small `Set(...).flatMap(...)` pattern-building chains with direct loops that avoid intermediate collections while keeping PascalCase and kebab-case matching.
- Updated `backend/src/tests/validation-scripts.test.js` source contracts to keep the helper and prevent the old pattern-building chain from returning.
- Renamed the optional save-load scope parameter in `backend/src/modules/saves.js` to `requestedConversationId` so the parallel scoped-load change no longer collides with the restored row `conversationId`.

## Validation

- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
- PASS: `node --test backend\src\tests\backend.test.js backend\src\tests\conversationStreamingRoutes.test.js`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Backend tests: 658 pass, 0 fail.
  - Frontend build: passed.

## Notes

- The scanner still reports no unreviewed potentially unreferenced Vue components.
- Reviewed dormant components remain `ExtensionManager.vue` and `VirtualMessageList.vue`.
- The save-load change is intentionally limited to parameter naming; the scoped conversation guard behavior remains intact.

## Next Recommended Task

Keep working in small diagnostic-script or source-hygiene slices while the worktree has many parallel frontend and backend changes.
