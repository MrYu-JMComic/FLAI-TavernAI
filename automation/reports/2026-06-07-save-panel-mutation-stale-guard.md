# Save Panel Mutation Stale Guard

Date: 2026-06-07

## Scope

Guarded save panel create, load, delete, and rename completions so old save requests cannot update, emit, or notify after the panel has switched away from the originating conversation and back again.

## Changed Files

- `frontend/src/components/SaveLoadPanel.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-save-panel-mutation-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 428 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 428 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 441/441.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 429 files.

## Notes

- Added a save mutation generation token that is invalidated on conversation reset.
- Save create, load, delete, and rename now require both the original conversation id and generation token to match before mutating panel state, emitting `loaded`, or showing notices.
- The token is not incremented for every write request, so independent same-conversation actions are not accidentally suppressed.

## Next Recommended Task

Review `NpcPanel.vue` memory and behavior mutations for stale conversation or NPC selection changes after write requests.
