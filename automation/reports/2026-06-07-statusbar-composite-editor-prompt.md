# 2026-06-07 Status Bar Composite Editor Prompt

## Goal

Improve custom status bar composite placeholder handling so rows such as `Location = {{Region}} > {{Place}}` are recognized as multiple child variables, edited as separate values, and described clearly to the status bar assistant.

## Relevant Changes

- Updated the status bar assistant prompt to explain composite rows, child-variable updates, and `templateHints.compositeRows`.
- Added template hint payload data for custom status bar templates.
- Tightened placeholder matching to require complete `{{variable}}` pairs.
- Added composite row editing in the chat status bar drawer so child variables can be edited separately.
- Filtered stale composite wrapper variables during runtime status bar save.
- Reused composite row styling for the chat drawer without changing normal variable rows.

## Files Touched

- `backend/src/services/accessoryAgents.js`
- `backend/src/modules/statusBars.js`
- `backend/src/modules/advancedSettings.js`
- `backend/src/tests/accessoryAgents.test.js`
- `frontend/src/components/StatusBar.vue`
- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/components/chat/ChatSettingsDrawer.vue`
- `frontend/src/composables/chat/useChatAccessory.js`
- `frontend/src/styles.css`

## Validation

- `backend`: `npm.cmd test -- src/tests/accessoryAgents.test.js` passed; the project test script reported 441 passing tests.
- `frontend`: `npm.cmd run build` passed.
- `root`: `node scripts/check-encoding.mjs` passed.
- `root`: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed.

## Notes

- The workspace already had many unrelated modified and untracked files. This iteration avoided reverting or rewriting those unrelated changes.
