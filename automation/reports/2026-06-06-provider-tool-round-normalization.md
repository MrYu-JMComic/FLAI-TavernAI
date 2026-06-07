# 2026-06-06 Provider Tool Round Normalization

## Summary

- Centralized provider tool-completion round normalization in `providers.js`.
- Kept the existing 100-round cap while making invalid `maxRounds` values fall back to the default of 6 rounds.
- Prevented truthy non-numeric strings such as `not-a-number` from turning the tool loop into zero attempts.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-06-provider-tool-round-normalization.md`

## Validation

- `node --check src\services\providers.js` — PASS
- `node --test --test-name-pattern "runToolCompletion treats null options as defaults|runToolCompletion falls back for invalid max rounds|runToolCompletion caps requested tool rounds at one hundred|Anthropic tool completion maps" src\tests\backend.test.js` — PASS, 4 tests
- `npm.cmd test` in `backend` — PASS, 367 tests
- `node scripts\check-encoding.mjs` — PASS
- `git diff --check` — PASS, Windows line-ending warnings only
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` — PASS

## Notes

- Existing unrelated and parallel worktree changes were preserved.
- Sandbox initialization failed for several read/test commands, so the same commands were rerun with escalation.

## Next Recommended Task

- Review outbound provider request numeric options such as `temperature`, `topP`, and `maxTokens` so invalid user or preset values cannot serialize as `null`/`NaN` in upstream request bodies.
