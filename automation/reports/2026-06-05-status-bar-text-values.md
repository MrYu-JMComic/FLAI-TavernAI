# 2026-06-05 Status Bar Text Values

## Summary

- Added text-value support for status bar variables, so fields like name, gender, identity, location, injury, memory, and current event do not get coerced to `0`.
- Status bar agents can now update short string values through `update_status_bar`; numeric strings still normalize back to numbers for meter bars.
- Custom templates with `.sb-row > .sb-label + .sb-val` automatically bind the value cell to a status variable with the same label.
- Existing and new status bars infer variables from custom templates, including hardcoded text rows and `{{variable}}` placeholders.
- Character status-bar blueprint editing and chat status-bar editing now accept text in the variable value field.

## Changed Files

- `backend/src/modules/statusBars.js`
- `backend/src/modules/advancedSettings.js`
- `backend/src/services/accessoryAgents.js`
- `backend/src/validations/schemas.js`
- `backend/src/tests/accessoryAgents.test.js`
- `frontend/src/components/StatusBar.vue`
- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/components/chat/ChatSettingsDrawer.vue`
- `frontend/src/composables/chat/useChatAccessory.js`

## Validation

- `node scripts/check-encoding.mjs`: PASS
- `npm.cmd test -- src/tests/accessoryAgents.test.js` in `backend`: PASS
- `node --test src/tests/npcs.test.js` in `backend`: FAIL, existing unrelated `listConversationNpcs includes registry NPCs and hides removed NPCs`
- `npm.cmd run build` in `frontend`: PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: FAIL because the unrelated NPC test above fails; encoding and frontend build pass.

## Notes

- Existing templates that hardcode text values now update when the status bar has, or can infer, a same-name variable from `.sb-label`.
- The failing NPC test is in `backend/src/tests/npcs.test.js` and asserts that `老板娘` is included in `listConversationNpcs`; this run did not modify NPC modules or tests.
- Vite still reports the existing large chunk warning for `StatusBar`, but the build succeeds.
