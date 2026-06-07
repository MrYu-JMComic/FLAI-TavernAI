# Assistant Tool Round Limit 100

## Summary

- Increased the shared tool-completion round cap from 10 to 100.
- Updated the manual character and world book assistants to request up to 100 tool rounds.
- Kept automatic accessory agents at their existing 2-3 round limits to avoid unexpected background cost and latency.
- Stopped world book JSON fallback responses from burning through the full retry budget when the model returns a usable fenced JSON draft without a tool call.

## Changed Files

- `backend/src/services/providers.js`
- `backend/src/services/characterAssistant.js`
- `backend/src/services/worldBookAssistant.js`
- `backend/src/tests/backend.test.js`

## Validation

- `node scripts/check-encoding.mjs` - passed
- `cd backend && npm test` - passed, 365 tests

## Notes

- Allowing 100 rounds can make slow models much more expensive and may still hit the route timeout if each model call is slow.
- Existing unrelated working tree changes were preserved.

## Next Recommended Task

- Consider exposing assistant round limits and timeouts as explicit settings so users can choose speed/cost tradeoffs per assistant.
