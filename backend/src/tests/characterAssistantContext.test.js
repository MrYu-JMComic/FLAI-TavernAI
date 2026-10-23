import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCharacterContext, characterContextCache } from '../services/characterAssistantContext.js';
import { buildAnthropicBody } from '../services/providerAnthropic.js';

test('assistant context preserves the reusable history prefix and bounds the newest valid history', () => {
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: `${index}:` + 'a'.repeat(5_000)
  }));
  history.push({ role: 'system', content: 'untrusted history system prompt' });
  const first = buildCharacterContext({
    system: 'Stable instructions', history, stablePrefix: true,
    payload: { requirement: 'First request', currentCharacter: { name: 'Old name' } }
  });
  const second = buildCharacterContext({
    system: 'Stable instructions', history, stablePrefix: true,
    payload: { requirement: 'Next request', currentCharacter: { name: 'New name' } }
  });
  assert.deepEqual(first.messages.slice(0, -1), second.messages.slice(0, -1));
  assert.notEqual(first.messages.at(-1).content, second.messages.at(-1).content);
  const recent = first.messages.slice(1, -1);
  assert.ok(recent.reduce((sum, message) => sum + message.content.length, 0) <= 32_000);
  assert.equal(recent.at(-1).content, history.at(-2).content);
  assert.ok(recent.every((message) => message.role !== 'system'));
  assert.equal(first.context.droppedHistoryMessages, 40 - recent.length);
  assert.ok(first.context.truncatedHistoryMessages > 0);
  assert.equal(first.context.strategy, 'stable-prefix-v1');
  assert.ok(first.context.estimatedTokens > 0);
  assert.equal(first.context.components.find(({ key }) => key === 'character').label, '当前角色卡');
});

test('assistant cache reports provider facts and keeps absent metrics unknown', () => {
  assert.deepEqual(characterContextCache({ prompt_tokens: 100 }), {
    strategy: 'provider-prefix', scope: 'last-provider-request', reported: false,
    cachedTokens: null, inputTokens: 100, hitRate: null
  });
  assert.equal(characterContextCache(null).cachedTokens, null);
  assert.equal(characterContextCache({ prompt_tokens_details: { cached_tokens: 0 } }).reported, true);
  assert.equal(characterContextCache({ prompt_tokens: 100, prompt_cache_hit_tokens: 60 }).hitRate, 0.6);
  assert.equal(characterContextCache({ input_tokens: 100, input_tokens_details: { cached_tokens: 70 } }).hitRate, 0.7);
  const anthropic = characterContextCache({ input_tokens: 100, cache_read_input_tokens: 600, cache_creation_input_tokens: 300 });
  assert.equal(anthropic.inputTokens, 1_000);
  assert.equal(anthropic.cachedTokens, 600);
  assert.equal(anthropic.hitRate, 0.6);
  assert.equal(characterContextCache({ prompt_cache_hit_tokens: false }).reported, false);
});

test('Anthropic caching is explicitly enabled only for the stable assistant system prefix', () => {
  const settings = { providerType: 'anthropic', model: 'test-model', extraBody: {} };
  const messages = [{ role: 'system', content: 'Fixed instructions' }, { role: 'user', content: 'Changing card' }];
  assert.equal(buildAnthropicBody(settings, messages, false).system, 'Fixed instructions');
  const cached = buildAnthropicBody(settings, messages, false, { cacheAssistantPrefix: true });
  assert.deepEqual(cached.system, [{ type: 'text', text: 'Fixed instructions', cache_control: { type: 'ephemeral' } }]);
  assert.equal(cached.messages[0].content, 'Changing card');
});
