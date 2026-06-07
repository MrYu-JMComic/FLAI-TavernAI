# Unreferenced Vue component scan

Date: 2026-06-07

## Scope

Ran a small unused-code evidence pass for frontend Vue components.

## Scan method

For each `frontend/src/components/**/*.vue` file, searched `frontend/src` for the component basename and ignored the component's own file.

## Findings

These component basenames had no external `frontend/src` references in the scan:

- `frontend/src/components/CharacterImagePanel.vue`
- `frontend/src/components/ExtensionManager.vue`
- `frontend/src/components/TalentBadge.vue`
- `frontend/src/components/TalentRollDialog.vue`
- `frontend/src/components/VirtualMessageList.vue`

## Changed files

- `automation/backlog.md`
  - Added a review item for the unreferenced component candidates.
- `automation/reports/2026-06-07-unreferenced-vue-component-scan.md`
  - Recorded this scan.

## Safety decision

No files were deleted. The repository rules require avoiding destructive actions without explicit user approval, and some of these components may be planned features or temporarily disconnected by the current dirty worktree.

## Validation

- PASS: `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 316 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding checks passed.
  - Backend tests passed: 390/390.
  - Frontend build passed.

## Next recommended task

For each candidate, decide whether to rewire it, add coverage if it is intentionally dormant, or delete it with explicit approval after verifying it is not referenced by route metadata, dynamic imports, or planned feature work.
