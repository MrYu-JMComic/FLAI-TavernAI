# Autonomous Report: Reviewed Unreferenced Vue Components

## Summary

Added a reviewed-dormant component list for the unreferenced Vue component scanner. This keeps the scanner useful after the original candidates have been audited: truly unreviewed candidates still appear as actionable findings, while reviewed dormant components are reported separately with rationale and report links.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
  - Reads `automation/reviewed-unreferenced-vue-components.json`.
  - Splits unreferenced components into `candidates` and `reviewed`.
  - Keeps `--fail-on-candidates` strict only for unreviewed candidates.
  - Supports `--reviewed-file` for fixture validation.
- `automation/reviewed-unreferenced-vue-components.json`
  - Records `ExtensionManager.vue` as `legacy-dormant`.
  - Records `VirtualMessageList.vue` as `performance-dormant`.
- `backend/src/tests/validation-scripts.test.js`
  - Verifies the scanner JSON exposes both groups.
  - Adds fixture coverage for reviewed dormant components.
- `automation/backlog.md`
  - Updates the backlog to reflect that the scanner currently has no unreviewed Vue component candidates.

## Validation

- PASS: `node scripts/find-unreferenced-vue-components.mjs`
  - No unreviewed candidates.
  - Reviewed dormant components: `ExtensionManager.vue`, `VirtualMessageList.vue`.
- PASS: `node scripts/find-unreferenced-vue-components.mjs --json`
  - `candidates: []`.
  - `reviewed.length: 2`.
- PASS: `node --test src\tests\validation-scripts.test.js`
  - 5/5 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue diagnostic reports 0 unreviewed candidates and 2 reviewed dormant components.
  - Backend tests passed: 392/392.
  - Frontend build passed.
- PASS: post-report `node scripts/check-encoding.mjs`
  - Scanned 328 files after this report and the reviewed list were added.

## Remaining Attention

`ExtensionManager.vue` and `VirtualMessageList.vue` are still unreferenced by design. They should remain visible in the reviewed list until either:

- they are safely rewired with matching runtime contracts, or
- the user explicitly approves deleting dormant files.
