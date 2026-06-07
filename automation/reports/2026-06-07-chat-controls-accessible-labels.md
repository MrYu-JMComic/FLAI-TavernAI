# 2026-06-07 Chat Controls Accessible Labels

## Backlog Item

- Add lightweight accessibility checks for forms and chat controls.

## Changes

- Added accessible names to chat header icon-only controls in `frontend/src/components/chat/ChatHeader.vue`.
  - Mobile sidebar button.
  - Home navigation button.
  - Economy panel button.
  - NPC panel button.
  - Save panel button.
- Added accessible names to chat composer controls in `frontend/src/components/chat/ChatComposer.vue`.
  - Scroll-to-bottom button.
  - Message textarea.
  - Preset selector.
  - Stop-generation button.
  - Send button.

## Validation

- PASS: `npm.cmd run build` in `frontend`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Backend tests passed: 392/392.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report was written.

## Notes

- The worktree already contained many modified and untracked files from earlier iterations; this run only intentionally changed chat control accessibility labels and this report.
- Next recommended task: add a small static accessibility diagnostic for icon-only buttons once the project has a stable scanner pattern for Vue templates.
