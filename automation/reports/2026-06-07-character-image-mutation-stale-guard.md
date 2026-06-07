# Character Image Mutation Stale Guard

Date: 2026-06-07

## Scope

Guarded character image panel edit, default, delete, and reorder mutations so stale completions after a character switch cannot refresh or notify the currently displayed character panel.

## Changed Files

- `frontend/src/components/CharacterImagePanel.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-character-image-mutation-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 426 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 426 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 441/441.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 427 files.

## Notes

- Added a mutation token that is invalidated whenever the panel switches `characterId`.
- Edit, default, delete, and reorder requests now use the `characterId` captured when the action starts.
- Stale mutation completions skip `loadImages()`, success notices, edit-form cleanup, and error notices after the panel has moved to another character.
- Default selection still completes both backend updates for the original character instead of stopping after clearing the old default.

## Next Recommended Task

Review other panel mutation flows, especially NPC/economy/save panels, for stale route or conversation-switch refreshes after write requests.
