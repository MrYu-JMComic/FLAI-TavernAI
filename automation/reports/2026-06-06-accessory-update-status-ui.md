# Accessory Update Status UI

## Summary

- Added visible update badges for the status bar and NPC panel with three states: `更新中`, `已更新`, and `未更新`.
- Wired the badges to the existing accessory background refresh loop after a main AI reply completes.
- Status bar state compares the current status bar snapshot against refreshed status bar data.
- NPC state compares NPC list fingerprints, including names, counts, source, confidence, and evidence.

## Changed Files

- `frontend/src/composables/chat/useChatSubmit.js`
- `frontend/src/views/ChatView.vue`
- `frontend/src/components/StatusBar.vue`
- `frontend/src/components/NpcPanel.vue`
- `automation/reports/2026-06-06-accessory-update-status-ui.md`

## Validation

- `npm.cmd run build` in `frontend`: passed.
- `node scripts/check-encoding.mjs`: passed.

## Notes

- The implementation is frontend-only and does not alter persisted database schema.
- The UI uses polling results because background accessory agents are currently started after the main reply response ends.

## Next Recommended Task

- Consider exposing live accessory-agent completion events from the backend if future work needs instant status updates without polling.
