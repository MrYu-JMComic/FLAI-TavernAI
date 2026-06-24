# Status Bar Agent Skip Tool

## Summary

- Added a `skip_status_bar_update` tool for the status bar accessory agent.
- When the agent calls the skip tool, backend processing stops the tool loop and bypasses both model-text and assistant-reply fallback extraction.
- Added regression coverage proving an explicit skip preserves the existing status bar even when the reply text contains a pattern that fallback extraction could otherwise parse.

## Changed Files

- `backend/src/services/accessoryAgents.js`
- `backend/src/tests/accessoryAgents.test.js`

## Validation

- `node --check src/services/accessoryAgents.js` from `backend` passed.
- `node --test src/tests/accessoryAgents.test.js` from `backend` passed.
- `npm test` from `backend` passed: 976 tests.
- `node scripts/check-encoding.mjs` passed.
- Frontend build was not run because this was a backend-only accessory-agent protocol change.

## Notes

- The worktree already contained unrelated modified and untracked files before this iteration. This run only adds the status bar skip-tool path and its test coverage.

## Next Recommended Task

- Consider applying the same explicit skip-tool pattern to other background agents if they need to suppress heuristic fallbacks.
