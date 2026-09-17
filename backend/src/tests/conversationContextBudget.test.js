import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConversationCompletionOptions,
  describeConversationContextBudget,
} from '../services/conversationContextBudget.js';
import { buildProviderBody } from '../services/providerRequestBody.js';

test('conversation completion options leave output unlimited by default', () => {
  const options = buildConversationCompletionOptions({ providerType: 'custom', model: 'model' });
  assert.equal(options.maxTokens, 4096);
  assert.equal(options.unlimitedOutput, true);
  assert.equal(options.thinkingEnabled, true);
});

test('preset output cap is normalized when no conversation reservation overrides it', () => {
  const options = buildConversationCompletionOptions(
    { providerType: 'custom', model: 'model' },
    {},
    {},
    { maxTokens: 700, temperature: 0.4, topP: 0.8 }
  );
  assert.equal(options.maxTokens, 700);
  assert.equal(options.temperature, 0.4);
  assert.equal(options.topP, 0.8);
});

test('zero preset output limit is passed as an unlimited provider signal without changing input budgeting', () => {
  const options = buildConversationCompletionOptions(
    {
      providerType: 'custom',
      model: 'model',
      extraBody: {
        max_tokens: 1234,
        max_completion_tokens: 1234,
        max_output_tokens: 1234,
        maxTokens: 1234,
        maxCompletionTokens: 1234,
        maxOutputTokens: 1234
      }
    },
    { inputTokenLimit: 6000 },
    {},
    { maxTokens: 0 }
  );
  assert.equal(options.maxTokens, 4096);
  assert.equal(options.unlimitedOutput, true);
  const body = buildProviderBody(
    {
      providerType: 'custom',
      model: 'model',
      extraBody: {
        max_tokens: 1234,
        max_completion_tokens: 1234,
        max_output_tokens: 1234,
        maxTokens: 1234,
        maxCompletionTokens: 1234,
        maxOutputTokens: 1234
      }
    },
    [],
    false,
    options
  );
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.max_output_tokens, undefined);
  assert.equal(body.maxTokens, undefined);
  assert.equal(body.maxCompletionTokens, undefined);
  assert.equal(body.maxOutputTokens, undefined);
});

test('conversation reply reservation takes precedence over preset output cap', () => {
  const options = buildConversationCompletionOptions(
    { providerType: 'custom', model: 'model' },
    { reservedOutputTokens: 900 },
    {},
    { maxTokens: 700 }
  );
  assert.equal(options.maxTokens, 900);
});

test('Anthropic thinking normalization reserves enough room for reasoning and visible output', () => {
  const settings = {
    providerType: 'anthropic',
    model: 'claude-3-5-sonnet',
    supportsReasoning: true,
    extraBody: {},
  };
  const options = buildConversationCompletionOptions(settings, { reservedOutputTokens: 333 });
  assert.equal(options.thinkingEnabled, true);
  assert.equal(options.maxTokens, 333);
  assert.equal(options.unlimitedOutput, true);

  const disabled = buildConversationCompletionOptions(
    settings,
    { reservedOutputTokens: 333 },
    { thinkingEnabled: false }
  );
  assert.equal(disabled.thinkingEnabled, false);
  assert.equal(disabled.maxTokens, 333);
});

test('budget description exposes normalized output reservation and provider identity', () => {
  const described = describeConversationContextBudget(
    { inputTokenLimit: 6000, reservedOutputTokens: 700 },
    { providerType: 'custom', model: 'described-model' }
  );
  assert.equal(described.resolved.effectiveInputLimit, 6000);
  assert.equal(described.resolved.reservedOutputTokens, 700);
  assert.deepEqual(described.provider, { providerType: 'custom', model: 'described-model' });
});
