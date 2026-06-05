# NPC Noise Filter

## Summary

- Tightened NPC auto-discovery so markdown section headings and narrative fragments are not listed as NPCs.
- Filtered candidates that begin with ellipses or repeated dots, such as `......她没有` and `......妈知`.
- Added common non-NPC headings such as `主角信息`, `其他角色`, `特殊要素`, and `角色状态面板`.
- Added regression coverage while preserving valid speaker labels like `老板娘：欢迎回来`.

## Changed Files

- `backend/src/modules/npcs.js`
- `backend/src/tests/npcs.test.js`

## Validation

- `backend`: `node --test src/tests/npcs.test.js` passed, 9 tests.
- `backend`: `npm.cmd test` passed, 222 tests.
- `root`: `node scripts/check-encoding.mjs` passed.

## Next Recommended Task

- Consider adding a manual “hide scanned NPC” action for rare false positives that pass the scanner but are not worth deleting from source messages.
