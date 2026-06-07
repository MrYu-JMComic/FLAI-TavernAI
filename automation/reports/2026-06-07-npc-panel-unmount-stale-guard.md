# NPC Panel Unmount Stale Guard

Date: 2026-06-07

## Scope

Close an unmount stale-completion gap in the NPC side panel.

## Changes

- Added an NPC panel disposed flag that flips during component unmount.
- Invalidated pending NPC list, detail, and mutation tokens from the unmount cleanup path.
- Guarded NPC list/detail completions, error notifications, loading cleanup, and mutation completion checks against destroyed panel instances.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-npc-panel-unmount-stale-guard.md`

## Validation

- PASS: `git diff --check` (only existing CRLF working-copy warnings).
- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check scanned 452 files).
- PASS: `node scripts/check-encoding.mjs` (scanned 452 files before final report update).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).

## Next Recommended Task

Continue auditing side-panel and dialog components for async work that can outlive their owning view.
