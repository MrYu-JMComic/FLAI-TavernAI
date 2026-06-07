# AI Panel Edge Clamp

## Changed Files

- `frontend/src/views/CharacterFormView.vue`

## Summary

- Changed the AI draft panel viewport edge gap to `0` so the floating panel can touch the left, right, and bottom viewport edges.
- Kept the top clamp tied to the sticky topbar bottom edge so the drag handle remains reachable while still allowing the panel to sit flush against the safe top boundary.

## Validation

- `node scripts/check-encoding.mjs` passed.
- `npm.cmd run build` in `frontend` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed, including 356 backend tests and the frontend build.

## Next Recommended Task

- Manually drag the AI draft panel to each viewport edge on `/#/characters/new` and confirm it can sit flush without hiding the drag handle under the topbar.
