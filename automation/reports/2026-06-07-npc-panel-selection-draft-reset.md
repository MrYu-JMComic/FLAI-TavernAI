# NPC Panel Selection Draft Reset

Date: 2026-06-07

## Scope

Prevent stale add-memory and add-behavior draft state from leaking between NPC selections in the chat NPC side panel.

## Changes

- Added a shared NPC form reset helper for the memory and behavior draft forms.
- Routed NPC selection changes through a single setter that clears drafts when the selected NPC context changes.
- Applied the setter to manual selection, automatic reselection after list reloads, empty-list cleanup, and removed-NPC cleanup paths.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-npc-panel-selection-draft-reset.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (encoding, unreferenced Vue diagnostic, accessibility diagnostic, backend tests, frontend build, and Git status check passed).
- PASS: `node scripts/check-encoding.mjs` after report update.

## Next Recommended Task

Continue auditing long-lived chat drawers and panels for local draft state that should reset when conversation, character, provider, or selected-item context changes.
