# 2026-06-08 API Rate Limit Authenticated Budget

## Scope

- Tune API rate limits so normal authenticated app usage has enough request budget while unauthenticated traffic stays bounded.
- Keep login and register attempts on their existing strict auth limiter.

## Changed Files

- `backend/src/server.js`
- `backend/src/tests/serverRateLimit.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-api-rate-limit-authenticated-budget.md`

## What Changed

- Changed the general API limiter default window to 60 seconds and the anonymous limit to 240 requests.
- Added an authenticated API limit with `AUTHENTICATED_API_RATE_LIMIT_MAX`, falling back to the legacy `API_AUTHENTICATED_RATE_LIMIT_MAX` name.
- Defaulted authenticated requests to at least 900 requests per minute.
- Skipped API limiter checks for `OPTIONS` requests and kept auth attempt paths under the separate auth limiter.
- Added source-level tests covering the configured defaults, helper wiring, and auth limiter separation.

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
- PASS: backend test suite in review gate, including `serverRateLimit.test.js`
- PASS: `node scripts\check-encoding.mjs`

## Notes

- No secrets were written.
- Existing report/backlog changes were preserved.

## Next Recommended Task

- Consider adding runtime integration coverage for rate-limit headers if the limiter behavior needs request-level assertions later.
