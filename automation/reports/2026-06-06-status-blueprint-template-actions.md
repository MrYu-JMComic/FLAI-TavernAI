# Status Blueprint Template Actions

Date: 2026-06-06

## Scope

Fixed character initial status bar custom templates so template content can drive the variable list instead of forcing users to add every variable by hand.

## Changes

- Added automatic status blueprint variable inference from custom templates, including `.sb-label` / `.sb-val` rows, inline labels, and placeholders such as `{{HP}}`, `{{HP.max}}`, and `{{HP.percent}}`.
- Added normalized de-duplication so similar labels do not create duplicate or inconsistent variables.
- Updated custom status bar rendering to allow safe declarative buttons through `data-sb-action`, including quick reply, copy, and collapse actions.
- Updated frontend custom template sanitization to allow safe `button` elements while still blocking scripts, event handlers, external resources, and unsafe URLs.
- Updated character assistant status bar guidance so AI-generated templates use inferred variables, consistent placeholders, and safe declarative action buttons.
- Added backend coverage for template inference and de-duplication.

## Files

- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/components/StatusBar.vue`
- `frontend/src/composables/chat/useChatAccessory.js`
- `backend/src/modules/advancedSettings.js`
- `backend/src/modules/statusBars.js`
- `backend/src/services/characterAssistant.js`
- `backend/src/tests/accessoryAgents.test.js`

## Validation

- `node scripts/check-encoding.mjs` passed.
- `npm.cmd test` in `backend` passed: 235 tests.
- `npm.cmd run build` in `frontend` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed.

## Notes

- Raw JavaScript and Vue inside custom status bar templates remain blocked for safety. Interactive behavior is supported with whitelisted `data-sb-action` buttons instead.
- The worktree already contained many unrelated modified and untracked files; this run preserved them.

## Next Recommended Task

Add a small browser-level check for the character edit status blueprint preview so template inference and button actions are covered from the user-facing form.
