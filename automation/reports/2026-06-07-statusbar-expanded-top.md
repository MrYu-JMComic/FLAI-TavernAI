# Status Bar Expanded Top Preservation

## Task

Keep the collapsed status bar summary row visible after expanding, then render either the custom status bar template or the system status bar content below it.

## Changed Files

- `frontend/src/components/StatusBar.vue`

## Changes

- Made the expanded state always render the shared status bar summary header.
- Removed the custom-template-only floating collapse button and floating update badge.
- Let custom-template expanded status bars keep the normal status bar container chrome instead of clearing the outer card styling.

## Validation

- `npm.cmd run build` in `frontend` passed.
- `node scripts/check-encoding.mjs` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed, including backend tests and frontend build.

## Next Recommended Task

Add a focused frontend regression check for custom status bar expand/collapse rendering if the project adds component-level Vue tests.
