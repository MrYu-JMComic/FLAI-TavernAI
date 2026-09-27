import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimatePromptTokens,
  resolvePromptTokenBudget,
} from '../services/promptTokenBudget.js';

test('estimation includes provider instructions and structured tool call payloads', () => {
  const messages = [{ role: 'assistant', content: '' }];
  const base = estimatePromptTokens(messages);
  const extra = estimatePromptTokens([
    { ...messages[0], tool_calls: [{ id: 'call-1', function: { name: 'remember', arguments: JSON.stringify({ content: 'known fact '.repeat(200) }) } }] }
  ], { additionalMessages: [{ role: 'system', content: 'Provider instructions '.repeat(100) }] });
  assert.ok(extra.tokens > base.tokens + 500);
  assert.equal(extra.exact, false);
});
test('token estimate treats CJK more conservatively than ASCII chars divided by four', () => {
  const ascii = estimatePromptTokens([{ role: 'user', content: 'a'.repeat(40) }]);
  const cjk = estimatePromptTokens([{ role: 'user', content: '长期记忆世界设定角色剧情工具调用' }]);
  assert.equal(ascii.exact, false);
  assert.equal(ascii.estimated, true);
  assert.ok(cjk.breakdown.textTokens >= 16);
  assert.match(cjk.method, /heuristic/);
});

test('images, serialized tool schemas, and protocol envelopes are counted', () => {
  const estimate = estimatePromptTokens([{
    role: 'user',
    content: [{ type: 'text', text: 'inspect' }, { type: 'image_url', image_url: { url: 'x' } }],
  }], {
    providerType: 'openai',
    imageTokensPerImage: 777,
    tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
  });
  assert.equal(estimate.breakdown.imageCount, 1);
  assert.equal(estimate.breakdown.imageTokens, 777);
  assert.ok(estimate.breakdown.toolSchemaTokens > 0);
  assert.ok(estimate.breakdown.messageOverheadTokens > 0);
  assert.ok(estimate.breakdown.toolOverheadTokens > 0);
});

test('an injected text counter is honored but the aggregate remains explicitly estimated', () => {
  const estimate = estimatePromptTokens([{ role: 'user', content: 'hello' }], {
    countTextTokens: () => 2,
  });
  assert.equal(estimate.breakdown.textTokens, 2);
  assert.equal(estimate.exact, false);
  assert.match(estimate.warning, /heuristic/);
});

test('a throwing injected text counter falls back to the heuristic with a warning', () => {
  const estimate = estimatePromptTokens([{ role: 'user', content: 'fallback text' }], {
    countTextTokens: () => { throw new Error('tokenizer unavailable'); },
  });
  assert.ok(estimate.breakdown.textTokens > 0);
  assert.match(estimate.warning, /counter failed/);
});

test('unknown models use defaults and never invent a context window', () => {
  const budget = resolvePromptTokenBudget({ model: 'unknown-model', providerType: 'custom' });
  assert.equal(budget.inputTokenLimit, 8192);
  assert.equal(budget.reservedOutputTokens, 2048);
  assert.equal(budget.imageTokensPerImage, 1024);
  assert.equal(budget.contextWindowTokens, null);
  assert.equal(budget.effectiveInputLimit, 8192);
});

test('a scoped configured window constrains input only when model and provider match', () => {
  const matching = resolvePromptTokenBudget({ model: 'm1', providerType: 'p1' }, {
    inputTokenLimit: 9000,
    contextWindowTokens: 10000,
    reservedOutputTokens: 3000,
    forModel: 'm1',
    forProviderType: 'p1',
  });
  assert.equal(matching.effectiveInputLimit, 7000);
  assert.equal(matching.contextWindowTokens, 10000);

  const mismatch = resolvePromptTokenBudget({ model: 'm2', providerType: 'p1' }, {
    inputTokenLimit: 9000,
    contextWindowTokens: 10000,
    forModel: 'm1',
  });
  assert.equal(mismatch.contextWindowTokens, null);
  assert.equal(mismatch.effectiveInputLimit, 9000);
  assert.match(mismatch.warning, /does not match/);
});

test('context window scope may be stored with settings', () => {
  const budget = resolvePromptTokenBudget({
    model: 'stored-model',
    providerType: 'stored-provider',
    contextWindowTokens: 12000,
    forModel: 'stored-model',
    forProviderType: 'stored-provider',
    maxTokens: 2000,
  });
  assert.equal(budget.contextWindowTokens, 12000);
  assert.equal(budget.effectiveInputLimit, 8192);
});

test('oversized reservations report overflow instead of silently truncating input', () => {
  const budget = resolvePromptTokenBudget({ model: 'm1' }, {
    contextWindowTokens: 1000,
    reservedOutputTokens: 1200,
    forModel: 'm1',
  });
  assert.equal(budget.overflow, true);
  assert.equal(budget.effectiveInputLimit, 0);
  assert.match(budget.warning, /exceeds/);
});

test('boolean, blank, nonfinite, negative, and oversized token values are rejected', () => {
  const budget = resolvePromptTokenBudget({}, {
    inputTokenLimit: true,
    reservedOutputTokens: Number.POSITIVE_INFINITY,
    contextWindowTokens: '',
    imageTokensPerImage: false,
    forModel: 'unused',
  });
  assert.equal(budget.inputTokenLimit, 8192);
  assert.equal(budget.reservedOutputTokens, 2048);
  assert.equal(budget.contextWindowTokens, null);
  assert.match(budget.warning, /invalid input token allocation/);
  assert.match(budget.warning, /invalid reply reservation/);
  assert.match(budget.warning, /invalid context window/);
  assert.match(budget.warning, /invalid image token estimate/);

  assert.equal(resolvePromptTokenBudget({}, { inputTokenLimit: -1 }).inputTokenLimit, 8192);
  assert.equal(resolvePromptTokenBudget({}, { inputTokenLimit: 10_000_001 }).inputTokenLimit, 8192);
});

test('zero image cost and zero reply reservation are invalid and use documented defaults', () => {
  const estimate = estimatePromptTokens([{
    role: 'user',
    content: [{ type: 'image_url', image_url: { url: 'x' } }],
  }], { imageTokensPerImage: 0 });
  assert.equal(estimate.breakdown.imageTokens, 1024);
  assert.match(estimate.warning, /invalid image token estimate/);

  const budget = resolvePromptTokenBudget({}, {
    reservedOutputTokens: 0,
    imageTokensPerImage: 0,
  });
  assert.equal(budget.reservedOutputTokens, 2048);
  assert.equal(budget.imageTokensPerImage, 1024);
  assert.match(budget.warning, /invalid reply reservation/);
  assert.match(budget.warning, /invalid image token estimate/);
});
