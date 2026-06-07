# Status Bar Composite Placeholder Recognition

## Task

Improve status bar recognition for custom template rows like `地点 = {{大地点}} > {{具体位置}}`, where the visible row is composed from multiple child variables.

## Changed Files

- `backend/src/modules/advancedSettings.js`
- `backend/src/modules/statusBars.js`
- `backend/src/services/accessoryAgents.js`
- `backend/src/tests/accessoryAgents.test.js`
- `frontend/src/components/StatusBar.vue`

## Changes

- Stopped inferring custom template rows with placeholder-only values as literal row variables.
- Kept child placeholders such as `大地点` and `具体位置` as independently updatable status variables.
- Sent the status bar template to the status bar agent and instructed it to update child variables instead of writing raw `{{...}}` placeholder text.
- Added frontend nested placeholder resolution so existing saved values like `{{大地点}} > {{具体位置}}` can render from child variables when available.
- Cleared separator-only template value residue so empty composite values do not display as a bare `>`.
- Added backend regression tests for composite placeholder inference and updates.

## Validation

- `npm.cmd test -- src/tests/accessoryAgents.test.js` in `backend` passed; the command ran the backend test suite with 440 passing tests.
- `npm.cmd run build` in `frontend` passed.
- `node scripts/check-encoding.mjs` passed.

## Next Recommended Task

Add a small browser-level check for custom status bar templates once frontend component test infrastructure is available.
