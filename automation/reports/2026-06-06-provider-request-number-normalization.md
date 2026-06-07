# 2026-06-06 Provider Request Number Normalization

## Summary

- Hardened OpenAI-compatible provider request bodies so invalid numeric overrides do not serialize as JSON `null`.
- Preserved valid zero values for temperature, top-p, penalties, and max tokens.
- Hardened Anthropic request body construction so invalid `maxTokens` or `extraBody.max_tokens` falls back to `4096`, and invalid temperature/top-p overrides are skipped.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-06-provider-request-number-normalization.md`

## Validation

- `node --check src\services\providers.js` — PASS
- `node --test --test-name-pattern "buildProviderBody applies preset parameters|buildProviderBody ignores invalid numeric overrides|buildProviderBody treats null options as defaults|Anthropic completion falls back for invalid numeric request options|runToolCompletion falls back for invalid max rounds" src\tests\backend.test.js` — PASS, 5 tests
- `npm.cmd test` in `backend` — PASS, 369 tests
- `node scripts\check-encoding.mjs` — PASS
- `git diff --check` — PASS, Windows line-ending warnings only
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` — PASS

## Notes

- Existing unrelated and parallel worktree changes were preserved.
- Sandbox initialization failed for several read/test commands, so the same commands were rerun with escalation.

## Next Recommended Task

- Review provider request `extraBody` merge behavior for fields that should remain fully free-form versus fields that should be normalized by provider-specific builders.
