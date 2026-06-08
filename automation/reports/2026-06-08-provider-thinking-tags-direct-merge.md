# Provider Thinking Tags Direct Merge

## Summary

- Reused `appendReasoning` in `splitThinkingTags` so non-streaming thinking-tag extraction merges reasoning text directly.
- Removed the intermediate reasoning array, `push`, and final `join` from the non-streaming thinking-tag parser.
- Added a focused backend test covering multiple closed thinking tags plus a trailing open thinking tag.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-thinking-tags-direct-merge.md`

## Validation

- `node --test --test-name-pattern "OpenAI-compatible parser merges multiple thinking tags" backend\src\tests\backend.test.js` - pass, 1 test.
- `node scripts/check-encoding.mjs` - pass, scanned 400 files.
- `git diff --check` - pass; Git reported LF/CRLF working-copy warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS; backend tests 747/747 passed and frontend build passed.

## Next Recommended Task

- Continue with provider parser cleanup only where existing helpers can be reused and tests can prove the exact parsing contract.
