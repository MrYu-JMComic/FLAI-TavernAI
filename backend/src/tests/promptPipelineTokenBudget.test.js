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
  // The input allocation governs the conversation only, so overflow is measured
  // against conversationTokens rather than the whole prompt estimate.
  assert.equal(
    result.budget.overflowTokens,
    result.budget.conversationTokens - result.budget.tokenBudget.inputTokenLimit
  );
  assert.ok(result.budget.estimatedTokens > result.budget.conversationTokens);
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
  // Memory is system-built context, so the input allocation never trims it. Only
  // a model-scoped context window bounds every source at once, and a window is
  // ignored unless it is scoped to the model in play. The two most recent turns
  // are protected, so an older exchange is needed for history to be droppable.
  const result = applyPromptBudget([
    { role: 'system', content: 'contract', _promptContext: { section: 'director', protected: true } },
    ordinary,
    { role: 'user', content: '旧问题'.repeat(100), _promptSource: { id: 'history-user', revision: 7 } },
    { role: 'assistant', content: '旧回答'.repeat(100), _promptSource: { id: 'history-assistant', revision: 8 } },
    pinned,
    { role: 'user', content: '近问题'.repeat(50), _promptSource: { id: 'recent-user', revision: 9 } },
    { role: 'assistant', content: '近回答'.repeat(50), _promptSource: { id: 'recent-assistant', revision: 10 } },
    { role: 'user', content: 'current' },
  ], 32_000, {
    providerSettings: { providerType: 'custom', model: 'test-model' },
    tokenBudget: { contextWindowTokens: 500, reservedOutputTokens: 128, forModel: 'test-model' },
  });

  assert.deepEqual(
    result.budget.truncation.map((entry) => entry.sourceId || entry.role),
    ['memory-ordinary', 'history-user', 'history-assistant', 'memory-pinned']
  );
  assert.equal(result.messages.some((message) => String(message.content).includes('旧问题')), false);
  assert.equal(result.messages.some((message) => String(message.content).includes('旧回答')), false);
  // The protected pair keeps the latest turn readable instead of leaving the
  // model with a reply whose question was trimmed away.
  assert.equal(result.messages.some((message) => String(message.content).includes('近问题')), true);
  assert.equal(result.messages.some((message) => String(message.content).includes('近回答')), true);
  assert.equal(result.budget.sections.memory.originalCharacters, ordinary.content.length + pinned.content.length);
  assert.equal(result.budget.sections.memory.keptCharacters, 0);
});

test('the input allocation leaves system-built context alone', () => {
  // Regression guard for the dialogue-only redefinition of inputTokenLimit: a
  // tiny allocation must not reach memory, mods or lore.
  const result = applyPromptBudget([
    { role: 'system', content: 'contract' },
    { role: 'system', content: '记忆'.repeat(400), _promptContext: {
      section: 'memory', priority: 20, sourceId: 'memory-kept', sourceRevision: 3,
    } },
    { role: 'user', content: 'current' },
  ], 32_000, { tokenBudget: { inputTokenLimit: 1 } });

  assert.deepEqual(result.budget.truncation, []);
  assert.equal(result.budget.sections.memory.keptCharacters, result.budget.sections.memory.originalCharacters);
  assert.equal(result.selectionManifest.find((entry) => entry.sourceId === 'memory-kept').included, true);
  assert.ok(result.budget.systemTokens > 0);
});

test('selection manifest covers included and omitted raw sources with ids and revisions', () => {
  // The mod section is system-built, so only a model-scoped context window can
  // push it out of the prompt.
  const result = applyPromptBudget([
    { role: 'system', content: 'contract' },
    { role: 'system', content: 'x'.repeat(2000), _promptContext: {
      section: 'mods', priority: 10, sourceId: 'mod-1', sourceRevision: 9,
    } },
    { role: 'user', content: 'old', _promptSource: { id: 'message-1', revision: 10 } },
    { role: 'assistant', content: 'reply', _promptSource: { id: 'message-2', revision: 11 } },
    { role: 'user', content: 'current', _promptSource: { id: 'message-3', revision: 12 } },
  ], 1000, {
    providerSettings: { providerType: 'custom', model: 'test-model' },
    tokenBudget: { contextWindowTokens: 500, reservedOutputTokens: 128, forModel: 'test-model' },
  });

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
