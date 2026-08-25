import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listThinkingPreferenceLevels,
  normalizeThinkingLevel,
  resolveSupportedThinkingLevel,
  resolveThinkingPreferenceLevel,
  resolveThinkingControl
} from '../../../shared/providerThinking.js';
import { resolveProviderModelCapabilities } from '../../../shared/providerCapabilities.js';
import { buildAnthropicBody } from '../services/providerAnthropic.js';
import { buildOpenAiReasoning } from '../services/providerOpenAiResponses.js';
import { buildProviderBody } from '../services/providerRequestBody.js';
import { sendMessageSchema } from '../validations/schemas.js';

const messages = [{ role: 'user', content: 'hi' }];

function buildChatBody(providerType, model, thinkingLevel, extraBody = {}) {
  return buildProviderBody(
    { providerType, model, supportsReasoning: true, extraBody },
    messages,
    false,
    { thinkingLevel }
  );
}

test('thinking controls expose only model-supported levels', () => {
  const geminiFlash = resolveThinkingControl('gemini', 'gemini-2.5-flash', true);
  const geminiPro = resolveThinkingControl('gemini', 'gemini-3.1-pro', true);
  const xai = resolveThinkingControl('xai', 'grok-4.6', true);
  const kimi = resolveThinkingControl('kimi', 'kimi-k3', true);

  assert.deepEqual(geminiFlash.levels, ['off', 'low', 'medium', 'high']);
  assert.equal(geminiFlash.canDisable, true);
  assert.deepEqual(geminiPro.levels, ['low', 'medium', 'high']);
  assert.equal(geminiPro.canDisable, false);
  assert.deepEqual(xai.levels, ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(kimi.levels, ['low', 'high', 'max']);
  assert.equal(resolveSupportedThinkingLevel('off', xai), 'low');
  assert.deepEqual(listThinkingPreferenceLevels(xai), ['off', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(resolveThinkingPreferenceLevel('off', xai), 'off');
  assert.equal(normalizeThinkingLevel('disabled'), 'off');

  const capabilities = resolveProviderModelCapabilities({
    providerType: 'deepseek',
    model: 'deepseek-v4-flash',
    supportsReasoning: true
  });
  assert.deepEqual(capabilities.thinkingLevels, ['off', 'low', 'high', 'max']);
  assert.equal(capabilities.thinking.strategy, 'deepseek');

  const customGemini = resolveProviderModelCapabilities({
    providerType: 'custom',
    model: 'gemini-3.7-flash-high',
    supportsReasoning: true
  });
  assert.deepEqual(customGemini.thinkingLevels, ['low', 'medium', 'high']);
  assert.equal(customGemini.thinking.inferredProviderType, 'gemini');
  assert.equal(customGemini.thinking.canDisable, false);
});

test('DeepSeek maps canonical intensity to official thinking fields', () => {
  const off = buildChatBody('deepseek', 'deepseek-v4-flash', 'off');
  const medium = buildChatBody('deepseek', 'deepseek-v4-flash', 'medium');
  const max = buildChatBody('deepseek', 'deepseek-v4-flash', 'max');

  assert.deepEqual(off.thinking, { type: 'disabled' });
  assert.equal(off.reasoning_effort, undefined);
  assert.deepEqual(medium.thinking, { type: 'enabled' });
  assert.equal(medium.reasoning_effort, 'high');
  assert.equal(max.reasoning_effort, 'max');
});

test('Gemini maps OpenAI-compatible effort and preserves explicit native config', () => {
  const off = buildChatBody('gemini', 'gemini-2.5-flash', 'off');
  const medium = buildChatBody('gemini', 'gemini-2.5-flash', 'medium');
  const minimal = buildChatBody('gemini', 'gemini-3-flash-preview', 'minimal');
  const native = buildChatBody('gemini', 'gemini-2.5-flash', 'high', {
    extra_body: {
      google: {
        thinking_config: { thinking_budget: 0, include_thoughts: true }
      }
    }
  });

  assert.equal(off.reasoning_effort, undefined);
  assert.equal(off.extra_body.google.thinking_config.thinking_budget, 0);
  assert.equal(medium.reasoning_effort, undefined);
  assert.equal(medium.extra_body.google.thinking_config.thinking_budget, 8192);
  assert.equal(minimal.reasoning_effort, undefined);
  assert.equal(minimal.extra_body.google.thinking_config.thinking_level, 'minimal');
  assert.equal(native.reasoning_effort, undefined);
  assert.equal(native.extra_body.google.thinking_config.thinking_budget, 0);
});

test('custom gateways infer known model families for explicit intensity', () => {
  const gemini = buildChatBody('custom', 'gemini-3.7-flash-high', 'off');
  const deepseek = buildProviderBody(
    {
      providerType: 'custom',
      model: 'deepseek-v4-flash',
      supportsReasoning: true,
      extraBody: {}
    },
    messages,
    false,
    { thinkingLevel: 'max', temperature: 0.7 }
  );
  const unknown = buildChatBody('custom', 'local-reasoner', 'off');

  assert.equal(gemini.reasoning_effort, undefined);
  assert.equal(gemini.extra_body.google.thinking_config.thinking_level, 'low');
  assert.deepEqual(deepseek.thinking, { type: 'enabled' });
  assert.equal(deepseek.reasoning_effort, 'max');
  assert.equal(deepseek.temperature, undefined);
  assert.equal(unknown.reasoning_effort, 'none');
});

test('Gemini sanitizes unsupported minimal aliases and cast-level disable overrides stale config', () => {
  const alias = buildChatBody('gemini', 'gemini-3.7-flash-high', 'minimal');
  const cast = buildProviderBody(
    {
      providerType: 'custom',
      model: 'gemini-3.7-flash-high',
      supportsReasoning: true,
      extraBody: {
        extra_body: {
          google: {
            thinking_config: { thinking_level: 'minimal', include_thoughts: true }
          }
        }
      }
    },
    messages,
    false,
    { thinkingEnabled: false }
  );

  assert.equal(alias.extra_body.google.thinking_config.thinking_level, 'low');
  assert.equal(cast.extra_body.google.thinking_config.thinking_level, 'low');
  assert.equal(cast.extra_body.google.thinking_config.include_thoughts, true);
  assert.equal(JSON.stringify(cast).includes('thinking_level":"minimal'), false);
});

test('OpenAI and xAI Responses reasoning objects respect each effort vocabulary', () => {
  assert.deepEqual(
    buildOpenAiReasoning(
      { providerType: 'openai', model: 'gpt-5.6', extraBody: {} },
      { thinkingLevel: 'xhigh' }
    ),
    { effort: 'xhigh', summary: 'auto' }
  );
  assert.deepEqual(
    buildOpenAiReasoning(
      { providerType: 'openai', model: 'gpt-5.6', extraBody: {} },
      { thinkingLevel: 'off' }
    ),
    { effort: 'none', summary: 'auto' }
  );
  assert.deepEqual(
    buildOpenAiReasoning(
      { providerType: 'xai', model: 'grok-4.6', extraBody: {} },
      { thinkingLevel: 'off' }
    ),
    { effort: 'low' }
  );
});

test('Qwen, GLM, Kimi and Mistral use their native controls', () => {
  const qwen = buildChatBody('qwen', 'qwen3-plus', 'medium');
  const qwenOff = buildChatBody('qwen', 'qwen3-plus', 'off');
  const glm = buildChatBody('glm', 'glm-5.2', 'medium');
  const glmMinimal = buildChatBody('glm', 'glm-5.2', 'minimal');
  const glmMax = buildChatBody('glm', 'glm-5.2', 'xhigh');
  const kimi = buildChatBody('kimi', 'kimi-k3', 'off');
  const kimiSwitch = buildChatBody('kimi', 'kimi-k2.5', 'high');
  const mistral = buildChatBody('mistral', 'mistral-medium-3-5', 'low');

  assert.equal(qwen.enable_thinking, true);
  assert.equal(qwen.thinking_budget, 4096);
  assert.equal(qwenOff.enable_thinking, false);
  assert.equal(qwenOff.thinking_budget, undefined);
  assert.deepEqual(glm.thinking, { type: 'enabled' });
  assert.equal(glm.reasoning_effort, 'high');
  assert.deepEqual(glmMinimal.thinking, { type: 'disabled' });
  assert.equal(glmMinimal.reasoning_effort, 'none');
  assert.equal(glmMax.reasoning_effort, 'max');
  assert.equal(kimi.reasoning_effort, 'low');
  assert.deepEqual(kimiSwitch.thinking, { type: 'enabled' });
  assert.equal(mistral.reasoning_effort, 'high');
});

test('Anthropic maps adaptive effort and manual budgets', () => {
  const adaptive = buildAnthropicBody(
    { providerType: 'anthropic', model: 'claude-sonnet-4-6', supportsReasoning: true, extraBody: {} },
    messages,
    false,
    { thinkingLevel: 'medium' }
  );
  const off = buildAnthropicBody(
    { providerType: 'anthropic', model: 'claude-sonnet-4-6', supportsReasoning: true, extraBody: {} },
    messages,
    false,
    { thinkingLevel: 'off' }
  );
  const manual = buildAnthropicBody(
    { providerType: 'anthropic', model: 'claude-3-7-sonnet', supportsReasoning: true, extraBody: {} },
    messages,
    false,
    { thinkingLevel: 'high' }
  );

  assert.deepEqual(adaptive.thinking, { type: 'adaptive', display: 'summarized' });
  assert.equal(adaptive.output_config.effort, 'medium');
  assert.equal(off.thinking, undefined);
  assert.equal(manual.thinking.budget_tokens, 8192);
  assert.equal(manual.max_tokens, 9216);
});

test('chat request schema accepts canonical levels and rejects unknown values', () => {
  assert.equal(sendMessageSchema.parse({ thinkingLevel: 'max' }).thinkingLevel, 'max');
  assert.throws(() => sendMessageSchema.parse({ thinkingLevel: 'ultra' }));
});
