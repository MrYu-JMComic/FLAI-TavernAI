# Gemini OpenAI-Compatible Request Guard

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/routes/settings.js`
- `backend/src/tests/backend.test.js`
- `backend/src/tests/providerSettingsRoutes.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-gemini-openai-compatible-request-guard.md`

## Summary

- Normalized Gemini provider Base URLs from native Google endpoints such as `/models/...:generateContent` to the app's OpenAI-compatible `/openai` endpoint before requests are sent.
- Stripped native Gemini request-envelope fields such as `contents`, `systemInstruction`, `safetySettings`, `generationConfig`, and `cachedContent` from Gemini OpenAI-compatible extra bodies while preserving valid OpenAI-compatible extension fields.
- Sanitized saved and probed Gemini extra-body settings through the same request-body guard so pasted native examples do not keep causing invalid-payload failures.
- Added backend coverage for native Gemini URL normalization and native request-envelope field removal.
- Added route coverage proving saved Gemini settings return and persist the normalized URL and sanitized extra body.

## Validation

- PASS: `node --test --test-name-pattern "Gemini" src\tests\backend.test.js` in `backend`.
- PASS: `node --test src/tests/providerSettingsRoutes.test.js` in `backend`.
- PASS: `npm test` in `backend` (includes `node ../scripts/check-encoding.mjs`; 874 tests).
- PASS: `npm run build` in `frontend` (includes `node ../scripts/check-encoding.mjs`).
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Add a short Settings helper hint that Gemini uses the OpenAI-compatible endpoint and that the extra body should contain only OpenAI-compatible extension fields.
