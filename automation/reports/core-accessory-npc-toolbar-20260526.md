# Core Accessory NPC Toolbar Iteration - 2026-05-26

## Goal

Apply a small part of the core relief plan by keeping NPC management out of the default core chat toolbar unless the NPC accessory skill is enabled for the current conversation.

## Changes

- Updated `frontend/src/views/ChatView.vue`.
- Added `showNpcFeature`, derived from the local `npcAgent` accessory skill state.
- Guarded `openNpcPanel()` so the panel cannot open while the NPC skill is disabled.
- Hid the NPC toolbar button and unmounted `NpcPanel` unless `npcAgent` is active.

## Validation

- `backend`: `npm.cmd test` passed, 128/128 tests.
- `frontend`: `npm.cmd run build` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` could not run because `scripts/review-gate.ps1` is not present. Existing scripts are `check-encoding.mjs`, `check-workstation.ps1`, `self-evolve.ps1`, and `start-ai-workstation.bat`.

## Safety

- Did not touch `backend/data`, `backend/uploads`, `.env`, `node_modules`, or generated build output intentionally.
- Existing broad uncommitted work was preserved; this iteration only made a focused frontend visibility change and added this report.

## Next Recommended Task

Add or restore `scripts/review-gate.ps1` so the required governance gate can be executed, then continue trimming default chat chrome for disabled accessory skills.
