# Autonomous Report: Talent Components Rewire

## Summary

Reviewed `TalentBadge.vue` and `TalentRollDialog.vue` as unreferenced Vue component candidates. Evidence showed the talent feature is already implemented across frontend API helpers, backend routes, backend modules, chat prompt injection, and backend tests. The safe improvement was to wire the existing dialog into the character edit flow and reuse the badge component inside that dialog.

`ExtensionManager.vue` was also audited but not rewired. It manages a legacy in-memory frontend hook registry, while the current extension page manages backend tags, presets, Mods, and regex rules. Rewiring it now would expose a second, confusing extension system without proving runtime value.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
  - Imports `TalentRollDialog`.
  - Adds an edit-only "角色天赋" panel with a "管理天赋" action.
  - Opens the dialog only for existing characters with a valid character ID.
- `frontend/src/components/TalentRollDialog.vue`
  - Reloads data when `characterId` or edit permission changes.
  - Fetches talent pools only for editable characters to avoid read-only 403 paths.
  - Adds inline load error state with retry.
  - Disables Roll/delete behavior in read-only mode.
  - Adds confirmation before clearing all talents.
  - Reuses `TalentBadge` for result/list rarity display.
- `automation/backlog.md`
  - Updates the unreferenced Vue component review list to the current two remaining candidates.

## Evidence

- Frontend API helpers exist for talent pool CRUD, character talent Roll, list, delete, and clear.
- Backend character routes expose Roll/list/delete endpoints for character talents.
- Backend conversation route injects `buildTalentSystemPrompt` when the accessory skill is active.
- Backend tests cover talent pools, Roll behavior, ownership, ordering, and prompt generation.
- `node scripts/find-unreferenced-vue-components.mjs` now reports 2 candidates instead of 4; `TalentBadge.vue` and `TalentRollDialog.vue` are no longer listed.

## Validation

- PASS: `node scripts/find-unreferenced-vue-components.mjs`
  - Remaining candidates: `ExtensionManager.vue`, `VirtualMessageList.vue`.
- PASS: `npm.cmd run build` in `frontend`
  - Vite compiled the newly wired talent dialog and badge successfully.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue diagnostic reports 2 candidates.
  - Backend tests passed: 392/392.
  - Frontend build passed.
- PASS: post-report `node scripts/check-encoding.mjs`
  - Scanned 325 files after this report was added.

## Remaining Attention

Continue reviewing the two remaining unreferenced Vue component candidates one at a time:

- `ExtensionManager.vue`
- `VirtualMessageList.vue`
