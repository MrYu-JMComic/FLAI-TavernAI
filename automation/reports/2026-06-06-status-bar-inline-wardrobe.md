# Status Bar Inline Wardrobe Fix

## Summary

Fixed custom status bar text fields that were not reliably inferred or refreshed, especially inline clothing/carrying rows such as outfit, shoes, and carried items.

## Changed Files

- `backend/src/modules/statusBars.js`
- `backend/src/services/accessoryAgents.js`
- `backend/src/tests/accessoryAgents.test.js`
- `frontend/src/components/StatusBar.vue`
- `frontend/src/composables/chat/useChatAccessory.js`

## What Changed

- Broadened backend custom-template inference from strict `.sb-row` rows to generic `.sb-label` / `.sb-val` pairs and inline text labels before `.sb-val`.
- Preserved blank inferred custom fields as text variables instead of converting them to `0 / 100` meters.
- Improved text fallback extraction so adjacent fields like `上装：... 随身：... 鞋袜：...` update independently.
- Normalized variable matching by removing spacing and punctuation, reducing misses from labels with colons or punctuation.
- Updated the custom status bar renderer to refresh inline label/value pairs and force long custom values to wrap within the panel.
- Added an integration test for inferred inline wardrobe variables.

## Validation

- Passed: `node --test src\tests\accessoryAgents.test.js` in `backend` (8/8).
- Passed: `npm.cmd test` in `backend` (230/230).
- Passed: `npm.cmd run build` in `frontend`.
- Passed: `node scripts/check-encoding.mjs`.
- Not run: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`; sandbox execution failed and escalation was rejected because the script is untracked and would run outside the sandbox with `ExecutionPolicy Bypass`.

## Notes

- The worktree already contained many modified and untracked files before this run. Existing user changes were preserved.
- Backend `npm.cmd test` and the targeted Node test required escalation because the sandbox wrapper failed before command execution.

## Next Recommended Task

Add a small UI affordance in the status bar editor that lists inferred custom-template variables before saving, so users can see which labels the template will track.
