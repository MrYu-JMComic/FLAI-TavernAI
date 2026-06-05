# Native Reasoning Mode Fix

## Goal

Remove prompt-style thinking handling assumptions and route supported providers through their native reasoning / thinking request modes.

## Official API References Checked

- DeepSeek official Chinese docs: https://api-docs.deepseek.com/zh-cn/
- DeepSeek thinking mode guide: https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
- OpenAI reasoning guide: https://platform.openai.com/docs/guides/reasoning
- Anthropic extended thinking guide: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
- Anthropic effort guide: https://platform.claude.com/docs/en/build-with-claude/effort
- Gemini thinking guide: https://ai.google.dev/gemini-api/docs/thinking
- Gemini OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai
- xAI reasoning guide: https://docs.x.ai/docs/guides/reasoning
- Mistral reasoning guide: https://docs.mistral.ai/capabilities/reasoning/
- Qwen thinking mode docs: https://help.aliyun.com/zh/model-studio/deep-thinking
- Z.AI GLM thinking mode docs: https://docs.z.ai/guides/llm/glm-4.5
- Kimi K2.5 thinking model docs: https://platform.moonshot.ai/docs/guide/use-kimi-k2-thinking-model.en-US

## Changes

- `backend/src/services/providers.js`
  - Keeps DeepSeek on the official V4 model naming and maps legacy `deepseek-chat` / `deepseek-reasoner` aliases back to `deepseek-v4-flash`.
  - Uses DeepSeek native `thinking` and `reasoning_effort` request fields instead of switching to legacy reasoner models.
  - Removes unsupported sampling parameters when DeepSeek thinking mode is enabled.
  - Uses Gemini OpenAI-compatible `reasoning_effort` for thinking toggles.
  - Keeps custom providers from synthesizing provider-specific thinking fields automatically.
  - Adds native presets and thinking switches for Anthropic Claude, xAI Grok, Mistral, Qwen, Z.AI GLM, and Kimi.
  - Routes Anthropic through the native Messages API with `thinking`, `output_config.effort`, `x-api-key`, and stream thinking deltas.
  - Adds an Anthropic tool-use loop so character/world-book/accessory tool calls do not hit fake `/chat/completions`.
  - Routes xAI reasoning models through the Responses API with native `reasoning.effort`.
  - Uses Mistral `reasoning_effort`, Qwen `enable_thinking`, GLM `thinking.type`, and Kimi K2.5's native `thinking: { type: "disabled" }` opt-out.
  - Routes `<thinking>...</thinking>` output into stored reasoning and strips it from visible content in non-stream and stream responses.
  - Normalizes chat-completion responses from both OpenAI-compatible `choices[].message/delta` and DashScope-style `output.choices[].message/delta`, so Qwen-style reasoning can stream into the same frontend reasoning block.
  - Parses thought/content-array chunks with `thought: true` or `type: "thinking"`, covering Gemini/Mistral-style thought parts.
  - Extends Responses API streaming parsing beyond summary deltas to forward `response.reasoning_text.*`, `response.reasoning.*`, and compatible reasoning delta events to the frontend.
- `backend/src/tests/backend.test.js`
  - Updates DeepSeek reasoning assertions to official V4 `thinking` / `reasoning_effort`.
  - Adds custom-provider guard coverage to prevent automatic thinking-field synthesis.
  - Adds Gemini native reasoning-effort coverage.
  - Adds Mistral, Qwen, GLM, Kimi, xAI, Anthropic Messages, Anthropic streaming, and Anthropic tool-use coverage.
  - Adds regression tests for non-stream and split streaming `<thinking>` tag stripping.
  - Adds regression tests proving DashScope/Qwen output-message reasoning, Gemini/Mistral thought arrays, and non-summary Responses reasoning deltas are emitted as `reasoning` SSE events for frontend display.
- `backend/src/validations/schemas.js`
  - Allows the new explicit provider types.
- `frontend/src/views/SettingsView.vue`
  - Adds provider presets in settings for Anthropic, xAI, Mistral, Qwen, and Kimi.

## Validation

- Passed: `node --check backend/src/services/providers.js`
- Passed: `node scripts/check-encoding.mjs`
- Passed: `node --test --test-name-pattern "GLM thinking switch|Kimi thinking switch|Mistral thinking switch|Qwen thinking switch|xAI reasoning provider|Anthropic provider|Anthropic streaming parser|Anthropic tool completion|DeepSeek thinking switch|Gemini thinking switch|custom reasoning provider" src/tests/backend.test.js`
- Passed: `node --test --test-name-pattern "streaming parser reads output message reasoning|parser reads DashScope-style|thought content array|Responses streaming parser forwards|Responses streaming parser reads summary|Anthropic streaming parser|DeepSeek thinking switch|Gemini thinking switch|Qwen thinking switch|GLM thinking switch|Kimi thinking switch|Mistral thinking switch|xAI reasoning provider|OpenAI-compatible streaming parser reads reasoning_details" src/tests/backend.test.js`
- Passed: `npm.cmd run build` in `frontend`
- Failed: `npm.cmd test` in `backend` and `scripts/review-gate.ps1`
  - Related new reasoning tests passed.
  - Existing unrelated failures remain around `world_books.scan_depth`, `streaming chat does not persist empty assistant messages`, and Windows temp cleanup `EPERM`.

## Next Recommended Task

Fix the existing world book schema/test mismatch around `scan_depth`, then rerun the full review gate.
