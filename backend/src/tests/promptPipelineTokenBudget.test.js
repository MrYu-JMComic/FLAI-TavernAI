import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPromptBudget } from '../services/promptPipeline.js';

test('token budget preserves intact current input and reports unavoidable overflow', () => {
  const current = '当前用户输入'.repeat(400);
  const result = applyPromptBudget([
    { role: 'system', content: 'contract' },
    { role: 'user', content: 'old question', _promptSource: { id: 'u-old', revision: 2 } },
    { role: 'assistant', content: 'old answer', _promptSource: { id: 'a-old', revision: 3 } },
    { role: 'user', content: current, _promptSource: { id: 'u-current', revision: 4 } },
  ], 32_000, {
    tokenBudget: { inputTokenLimit: 100 },
    providerSettings: { providerType: 'custom', model: 'unknown' },
  });

  assert.equal(result.messages.at(-1).content, current);
  assert.equal(result.budget.overTokenBudget, true);
  assert.equal(
    result.budget.overflowTokens,
    result.budget.estimatedTokens - result.budget.tokenBudget.effectiveInputLimit
  );
  assert.equal(result.budget.tokenBudget.inputTokenLimit, 100);
  assert.equal(result.selectionManifest.find((entry) => entry.sourceId === 'u-current').reason, 'protected');
});

test('token trimming pairs old history and follows ordinary memory, history, pinned memory retention', () => {
  const ordinary = {
    role: 'system',
    content: '普通记忆'.repeat(200),
    _promptContext: { section: 'memory', priority: 20, sourceId: 'memory-ordinary', sourceRevision: 5 },
  };
  const pinned = {
    role: 'system',
    content: '置顶记忆'.repeat(200),
    _promptContext: { section: 'memory', priority: 35, sourceId: 'memory-pinned', sourceRevision: 6 },
  };
  const result = applyPromptBudget([
    { role: 'system', content: 'contract', _promptContext: { section: 'director', protected: true } },
    ordinary,
    { role: 'user', content: '旧问题'.repeat(100), _promptSource: { id: 'history-user', revision: 7 } },
    { role: 'assistant', content: '旧回答'.repeat(100), _promptSource: { id: 'history-assistant', revision: 8 } },
    pinned,
    { role: 'user', content: 'current' },
  ], 32_000, { tokenBudget: { inputTokenLimit: 50 } });

  assert.deepEqual(
    result.budget.truncation.map((entry) => entry.sourceId || entry.role),
    ['memory-ordinary', 'history-user', 'history-assistant', 'memory-pinned']
  );
  assert.equal(result.messages.some((message) => String(message.content).includes('旧问题')), false);
  assert.equal(result.messages.some((message) => String(message.content).includes('旧回答')), false);
  assert.equal(result.budget.sections.memory.originalCharacters, ordinary.content.length + pinned.content.length);
  assert.equal(result.budget.sections.memory.keptCharacters, 0);
});

test('selection manifest covers included and omitted raw sources with ids and revisions', () => {
  const result = applyPromptBudget([
    { role: 'system', content: 'contract' },
    { role: 'system', content: 'x'.repeat(2000), _promptContext: {
      section: 'mods', priority: 10, sourceId: 'mod-1', sourceRevision: 9,
    } },
    { role: 'user', content: 'old', _promptSource: { id: 'message-1', revision: 10 } },
    { role: 'assistant', content: 'reply', _promptSource: { id: 'message-2', revision: 11 } },
    { role: 'user', content: 'current', _promptSource: { id: 'message-3', revision: 12 } },
  ], 1000);

  assert.equal(result.selectionManifest.length, 5);
  assert.deepEqual(
    result.selectionManifest.find((entry) => entry.sourceId === 'mod-1'),
    {
      index: 1, role: 'system', section: 'mods', sourceId: 'mod-1', sourceRevision: 9,
      included: false, reason: 'section_omitted',
    }
  );
  assert.equal(result.selectionManifest.find((entry) => entry.sourceId === 'message-3').sourceRevision, 12);
  assert.ok(result.messages.every((message) => !Object.hasOwn(message, '_promptSource')));
  assert.ok(result.messages.every((message) => !Object.hasOwn(message, '_promptContext')));
});

test('budget exposes estimator breakdown and includes tools, images, and output reservation', () => {
  const result = applyPromptBudget([{
    role: 'user',
    content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'image' } }],
  }], 32_000, {
    providerSettings: { providerType: 'openai', model: 'gpt-test' },
    maxTokens: 512,
    tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
  });

  assert.equal(result.budget.tokenBudget.reservedOutputTokens, 512);
  assert.equal(result.budget.tokenEstimate.breakdown.imageCount, 1);
  assert.ok(result.budget.tokenEstimate.breakdown.toolSchemaTokens > 0);
  assert.equal(result.budget.tokenEstimate.exact, false);
});
