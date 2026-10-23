# Assistant Responses Tool Compatibility Plan

## Objective

Handle the assistant error `gpt-6.1-sol requires Responses for tool calls; this account only supports Chat Completions` with correct provider routing and actionable capability feedback.

## Scope

- Trace tool request protocol selection, provider configuration, and upstream error propagation.
- Verify official model-specific API requirements before changing protocol behavior.
- Implement the smallest compatible fix; preserve model/account choices and existing provider support.
- Remove obsolete routing or duplicated error handling only where superseded.
- Preserve unrelated edits and all saved user/provider data.

## Checklist

- [ ] Diagnose the error source and existing Responses support.
- [ ] Implement the supported routing or capability handling with meaningful regression tests.
- [ ] Validate tool continuation, streaming/non-streaming, and existing provider paths as applicable.
- [ ] Run backend tests, frontend build if changed, encoding check, and touched-path diff checks.
- [ ] Record results and remaining upstream account limitations.

## Acceptance Criteria

- The application does not send GPT-6.1 Sol tool calls through an unsupported Chat Completions route when Responses is available.
- An account limited to Chat Completions receives a clear, actionable explanation without silent model substitution or fake success.
- Existing supported models/providers and assistant tool results remain functional.
- Required checks pass and unrelated state remains intact.

## Validation Commands

- Focused provider/assistant tests selected after diagnosis.
- `npm test` in `backend` for backend changes.
- `npm run build` in `frontend` for frontend changes.
- `node scripts/check-encoding.mjs` at repository root.
- `git diff --check` for touched tracked paths.

## Initial Evidence

- Exact error text does not occur in repository source; it appears to originate upstream.
- Official OpenAI GPT-6.1 Sol model and function-calling documentation states Responses is required for tool calls; Chat Completions is supported without tool calling.
- Sources: https://developers.openai.com/api/docs/models/gpt-6.1-sol and https://developers.openai.com/api/docs/guides/function-calling.

## Task Disposition

- The user reported that the upstream service was under attack and indicated that no further fix was needed. Investigation stopped at that request.
- No application source, provider configuration, account, model choice, or saved data was changed for this task.
- Only this planning record was added. Implementation and regression validation were not started; the proposed routing work above remains unexecuted and is not a confirmed fix for this upstream incident.
