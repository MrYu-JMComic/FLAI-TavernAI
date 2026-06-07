# 2026-06-07 Home Chat Open Pending Guard

## Goal

Prevent duplicate same-character chat open requests from the Home character grid and list.

## Changes

- Added a per-character `chatOpenPending` map in `HomeView`.
- Ignored duplicate `openChat()` calls for the same character while the first fetch/create flow is pending.
- Cleared pending chat-open state when Home async scope is reset.
- Disabled both mobile-list and virtual-grid chat buttons while their character is opening.
- Added `aria-busy` and changed the button label to `打开中` during the pending operation.

## Files Touched

- `frontend/src/views/HomeView.vue`
- `automation/backlog.md`

## Validation

- `frontend`: `npm.cmd run build` passed.

## Notes

- Existing prepare-commit and Chat sidebar worktree changes were preserved.
