# World Book Scan Depth Normalization

## Summary

- Reused `normalizeFiniteNumber` for world book scan depth normalization.
- Consolidated scan depth clamping for create, update, row mapping, and `matchWorldBookEntries` overrides.
- Fixed invalid `options.scanDepth` values so they fall back to the bound books' configured scan depth instead of scanning the full history.
- Fixed `options.scanDepth: "0"` to clamp to `1` rather than expanding to every message through `slice(-0)`.

## Changed Files

- `backend/src/modules/worldBooks.js`
- `backend/src/tests/backend.test.js`

## Validation

- `node --check src\modules\worldBooks.js` - passed
- `node --test --test-name-pattern "world book scanDepth|world book trigger matching|world book lorebookContextPercent" src\tests\backend.test.js` - passed, 3 tests
- `node --test src\tests\utils.test.js` - passed, 4 tests
- `npm.cmd test` in `backend` - passed, 354 tests
- `npm.cmd run build` in `frontend` - passed

## Notes

- Existing unrelated worktree changes in chat/frontend/economy files and reports were left untouched.

## Next Recommended Task

- Continue reviewing remaining world book numeric normalizers, especially group weight and probability fields that still use implicit numeric fallbacks.
