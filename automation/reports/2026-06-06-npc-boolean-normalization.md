# Autonomous Iteration Report: NPC Boolean Normalization

Date: 2026-06-06

## Task

Continue the robustness pass by replacing NPC-specific ad hoc boolean coercion with the shared boolean normalizer.

## Changed Files

- `backend/src/modules/npcs.js`
- `backend/src/tests/npcs.test.js`

## What Changed

- Reused `normalizeBoolean` for NPC behavior `enabled` on create and update.
- Reused `normalizeBoolean` for NPC registry `hidden` and `unhide` flags.
- Preserved existing defaults:
  - New behaviors default to enabled.
  - Existing behavior enabled state is preserved when update payloads omit the field.
  - Hidden NPCs stay hidden unless `unhide` is truthy.
- Added regression coverage for string boolean flags:
  - `enabled: "false"` and `enabled: "true"` on NPC behaviors.
  - `hidden: "true"`, `hidden: "false"`, and `unhide: "true"` on NPC registry updates.

## Validation

- `node --check src\modules\npcs.js` passed.
- `node --test src\tests\npcs.test.js --test-name-pattern "NPC mutators normalize string boolean flags|NPC mutators treat null payloads as empty input|NPC behaviors CRUD with priority and toggle|listConversationNpcs includes registry NPCs and hides removed NPCs"` passed.
- `node --test src\tests\utils.test.js` passed.
- `npm.cmd test` in `backend` passed: 349/349 tests.
- `npm.cmd run build` in `frontend` passed.

## Notes

- Several commands initially hit the recurring Windows sandbox setup failure and were rerun with approved escalation.
- Existing unrelated worktree changes, including `automation/plans/20260606-worldbook-plan.md`, were preserved.

## Next Recommended Task

Continue scanning remaining direct payload coercion in presets and conversation request options, then patch only the cases whose defaults and compatibility behavior are clear.
