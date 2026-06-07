# 2026-06-06 World Book Message Count Normalization

## Summary

- Hardened world book sticky/cooldown/delay state against unsafe `messageCount` overrides.
- Normalized persisted `world_book_entry_state` counters when reading legacy rows so non-finite or unsafe values do not keep entries active incorrectly.
- Added regression coverage for non-finite message counts, unsafe integer-like counts, and corrupted legacy state rows.

## Changed Files

- `backend/src/modules/worldBooks.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-06-worldbook-message-count-normalization.md`

## Validation

- `node --check src\modules\worldBooks.js` — PASS
- `node --test --test-name-pattern "world book matcher normalizes unsafe message count state|world book sticky|world book cooldown|world book delay" src\tests\backend.test.js` — PASS, 5 tests
- `npm.cmd test` in `backend` — PASS, 366 tests
- `node scripts\check-encoding.mjs` — PASS
- `git diff --check` — PASS, Windows line-ending warnings only
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` — PASS

## Notes

- Existing unrelated worktree changes were preserved.
- Sandbox initialization failed repeatedly for read/test commands, so the same commands were rerun with escalation.

## Next Recommended Task

- Continue reviewing assistant/provider option normalization boundaries, especially request options that are persisted or reused across retries.
