# Unreferenced Vue component scanner script

Date: 2026-06-07

## Scope

Added a reusable static scanner for candidate unreferenced frontend Vue components.

## Changed files

- `scripts/find-unreferenced-vue-components.mjs`
  - Walks `frontend/src/components/**/*.vue`.
  - Searches `frontend/src` for each component basename and import-like relative path tokens.
  - Ignores the component's own file.
  - Reports candidates by default without failing, to avoid turning possible dynamic or planned references into CI failures.
  - Supports `--json` and `--fail-on-candidates` for stricter follow-up use.
- `automation/backlog.md`
  - Points the unreferenced component review item at the new script.
- `automation/reports/2026-06-07-unreferenced-vue-component-scanner-script.md`
  - Records this run.

## Scanner result

`node scripts/find-unreferenced-vue-components.mjs` reported:

- `frontend/src/components/CharacterImagePanel.vue`
- `frontend/src/components/ExtensionManager.vue`
- `frontend/src/components/TalentBadge.vue`
- `frontend/src/components/TalentRollDialog.vue`
- `frontend/src/components/VirtualMessageList.vue`

## Safety decision

No components were deleted. The scanner is intentionally non-destructive and defaults to exit code 0 because these candidates still need human review for dynamic imports, planned feature wiring, or dirty-worktree interactions.

## Validation

- PASS: `node scripts/find-unreferenced-vue-components.mjs`.
- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 318 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding checks passed.
  - Backend tests passed: 390/390.
  - Frontend build passed.

## Next recommended task

Pick one candidate component and verify its feature ownership path before deciding whether to rewire it, add a targeted guard, or delete it with explicit approval.
