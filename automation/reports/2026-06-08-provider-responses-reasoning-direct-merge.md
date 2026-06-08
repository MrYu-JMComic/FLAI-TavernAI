# Provider Responses Reasoning Direct Merge

## Summary

- Added a small `appendReasoning` helper so `mergeReasoning` and OpenAI Responses fallback parsing share the same trim-and-separate behavior.
- Reworked `extractOpenAiReasoning` to skip non-array `output` values and merge reasoning text as it scans, instead of building an intermediate item array.
- Added a focused backend test for non-streaming Responses reasoning sources and source contracts guarding against the removed item-array path.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-responses-reasoning-direct-merge.md`

## Validation

- `node --test --test-name-pattern "OpenAI Responses parser merges reasoning output" backend\src\tests\backend.test.js` - pass, 1 test.
- `node scripts/check-encoding.mjs` - pass, scanned 399 files.
- `git diff --check` - pass; Git reported LF/CRLF working-copy warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS; backend tests 746/746 passed and frontend build passed.

## Next Recommended Task

- Audit the remaining provider-specific reasoning extractors for correctness first, and only remove intermediate allocations where the direct path is easier to read and test.
