# Autonomous Report: Character Image Panel Rewire

## Summary

Reviewed `CharacterImagePanel.vue` as an unreferenced Vue component candidate. Evidence showed the character image feature is supported by frontend API helpers, backend routes, backend modules, accessory-agent runtime usage, and backend tests. The safer improvement was to rewire the panel into the character edit flow instead of deleting it.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
  - Imports `CharacterImagePanel`.
  - Shows the panel only when editing an existing character, because new characters do not have an image API target until after the initial save.
- `frontend/src/components/CharacterImagePanel.vue`
  - Reloads images when `characterId` changes.
  - Adds inline load error state with retry.
  - Prevents panel action buttons from submitting the parent character form.
  - Disables drag behavior in read-only mode.
  - Removes an unused icon import and tightens panel spacing for the embedded location.

## Evidence

- Frontend API helpers exist for list/create/update/delete/reorder character images.
- Backend character routes expose `/api/characters/:id/images` CRUD and ordering endpoints.
- Backend `accessoryAgents` uses character images for CG scene selection.
- Backend tests cover character image CRUD, ordering, matching, limits, and ownership.
- `node scripts/find-unreferenced-vue-components.mjs` now reports 4 candidates instead of 5; `CharacterImagePanel.vue` is no longer listed.

## Validation

- PASS: `npm.cmd run build` in `frontend`
  - Vite compiled the newly wired component successfully.
- PASS: `node scripts/find-unreferenced-vue-components.mjs`
  - Remaining candidates: `ExtensionManager.vue`, `TalentBadge.vue`, `TalentRollDialog.vue`, `VirtualMessageList.vue`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue diagnostic reports 4 candidates.
  - Backend tests passed: 392/392.
  - Frontend build passed.
- PASS: post-report `node scripts/check-encoding.mjs`
  - Scanned 324 files after this report was added.

## Remaining Attention

Continue reviewing the four remaining unreferenced Vue component candidates one at a time before deleting or rewiring anything.
