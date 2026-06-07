# 2026-06-06 Provider Extra Body Reserved Fields

## Summary

- Protected provider request reserved fields from top-level `extraBody` overrides.
- OpenAI-compatible chat requests now keep their canonical `model`, `messages`, and `stream` values while still preserving custom extra fields.
- OpenAI Responses requests now keep canonical `model`, `input`, `reasoning`, and explicit stream mode.
- Anthropic requests now keep canonical `model`, `messages`, `stream`, and normalized `max_tokens` while still preserving custom extra fields.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-06-provider-extra-body-reserved-fields.md`

## Validation

- `node --check src\services\providers.js` — PASS
- `node --test --test-name-pattern "streamCompletion treats null options as defaults|OpenAI Responses request protects reserved fields from extra body|Anthropic completion falls back for invalid numeric request options|Anthropic streaming parser separates thinking deltas and text deltas|buildProviderBody protects reserved fields from extra body|buildProviderBody ignores invalid numeric overrides" src\tests\backend.test.js` — PASS, 6 tests
- `npm.cmd test` in `backend` — PASS, 371 tests
- `node scripts\check-encoding.mjs` — PASS
- `git diff --check` — PASS, Windows line-ending warnings only
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` — PASS

## Notes

- Existing unrelated and parallel worktree changes were preserved.
- Sandbox initialization failed for several read/test commands, so the same commands were rerun with escalation.

## Next Recommended Task

- Review provider-specific request builders for remaining duplicated merge logic that could be centralized without weakening provider-specific behavior.
