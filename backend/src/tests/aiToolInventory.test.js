import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

process.env.FLAI_DB_PATH = ':memory:';
const { auditAiToolContracts, collectAiToolContracts } = await import('../services/aiToolContractAudit.js');
const { executeProviderTool } = await import('../services/providerToolResults.js');
const { optimizeTools } = await import('../services/toolSchemaOptimizer.js');
const { adaptToolsForProvider } = await import('../services/toolProviderAdapter.js');
const contracts = collectAiToolContracts();
const definitions = new Map(contracts.map(({ definition }) => [definition.function.name, definition]));

test('production inventory includes every optional, planning and legacy contract with a policy', () => {
  const report = auditAiToolContracts(contracts);
  assert.deepEqual(report.errors, []);
  assert.equal(report.tools.length, 64);
  assert.equal(report.exceptions.length, 2);
  assert.deepEqual(report.exceptions.map(item => item.path.split('.').at(-1)).sort(), ['oldValue', 'value']);
  assert.equal(new Set(contracts.map(item => item.family)).size, 12);
  for (const name of ['travel_to_location', 'propose_reward', 'submit_character_plan', 'submit_world_book_plan',
    'batch_memory_changes', 'batch_scene_changes', 'batch_world_book_entries', 'deepseek_web_fetch']) assert.ok(definitions.has(name), name);
});

test('audit reports schema holes instead of claiming automatic compatibility repair', () => {
  const changed = structuredClone(contracts);
  const root = changed.find(item => item.definition.function.name === 'upsert_scene_node').definition.function.parameters;
  delete root.additionalProperties;
  delete root.properties.tags.maxItems;
  delete root.properties.tags.items;
  root.required.push('undeclared');
  root.properties.layout.properties.untyped = {};
  const errors = auditAiToolContracts(changed).errors.join('\n');
  assert.match(errors, /fixed object must be closed/);
  assert.match(errors, /array requires maxItems/);
  assert.match(errors, /array requires items/);
  assert.match(errors, /required field undeclared is not declared/);
  assert.match(errors, /untyped: missing value type/);
});

const rejected = [
  ['upsert_scene_node', { id: 'n', description: 'edited', skipWorldEvent: true }],
  ['upsert_scene_node', { id: 'n', permanent: false }],
  ['upsert_scene_node', { id: 'n', layout: { x: 30, source: 'user' } }],
  ['upsert_scene_node', { id: 'n', tags: Array(51).fill('tag') }],
  ['upsert_scene_node', { id: 'n', tags: { one: 'tag' } }],
  ['request_skill_check', { skill: 'lockpick', difficulty: 12, roll: 20, outcome: 'success' }],
  ['create_quest', { title: 'Explore', objectives: [{ description: 'Enter', completed: true }] }],
  ['propose_reward', { sourceType: 'quest', sourceId: 'q', rewards: { currency: [{ currencyType: 'gold', amount: 1, balance: 999 }] } }],
  ['record_economy_transaction', { amount: 1, type: 'reward', currencyType: 'gold', auditActor: 'user' }],
  ['record_economy_transaction', { amount: 1e100, type: 'reward', currencyType: 'gold' }],
  ['batch_scene_changes', { operations: [{ tool: 'finish_scene_organization', arguments: { summary: 'done' } }] }],
  ['batch_scene_changes', { operations: [{ tool: 'remove_scene_route', arguments: { sourceId: 'x' } }] }],
  ['batch_world_book_entries', { operations: [{ op: 'remove', entryId: 'e', changes: { name: 'x' } }] }],
  ['patch_world_book_text', { edits: { e: { oldText: 'x', newText: 'y' } } }]
];

test('real tool boundary rejects undeclared mutation controls and malformed collections before dispatch', async () => {
  let dispatched = 0;
  for (const [name, args] of rejected) {
    const result = await executeProviderTool(() => { dispatched += 1; return { ok: true }; }, name, args, {}, undefined, [definitions.get(name)]);
    assert.equal(result.result.error, 'TOOL_ARGUMENTS_INVALID', `${name}: ${JSON.stringify(args)}`);
  }
  assert.equal(dispatched, 0);
  for (const amount of [0.005, 0.01, 1.234]) {
    const result = await executeProviderTool(() => { dispatched += 1; return { ok: true }; }, 'record_economy_transaction',
      { amount, type: 'income', currencyType: 'gold' }, {}, undefined, [definitions.get('record_economy_transaction')]);
    assert.equal(result.result.ok, true, `roundable economy amount ${amount}`);
  }
  assert.equal(dispatched, 3);
});

test('provider schema transforms retain the real precision/batch contracts and rejection bounds', () => {
  const names = ['upsert_scene_node', 'patch_scene_text', 'batch_scene_changes', 'patch_world_book_text', 'batch_world_book_entries', 'propose_reward'];
  const source = names.map(name => definitions.get(name));
  const before = structuredClone(source);
  for (const [provider, model] of [['openai', 'model'], ['anthropic', 'claude'], ['deepseek', 'model'], ['gemini', 'gemini'], ['custom', 'gemini-proxy']]) {
    const adapted = adaptToolsForProvider(optimizeTools(source), provider, model);
    for (const tool of adapted) {
      const validation = z.fromJSONSchema(tool.function.parameters);
      for (const [name, args] of rejected.filter(([name]) => name === tool.function.name)) assert.equal(validation.safeParse(args).success, false, `${provider}: ${name}`);
    }
    const batch = adapted.find(item => item.function.name === 'batch_scene_changes').function.parameters;
    assert.deepEqual(batch.required, ['operations']);
    assert.equal(batch.additionalProperties, false);
    assert.equal(batch.properties.operations.maxItems, 24);
    assert.equal(batch.properties.operations.items.anyOf.length, 5);
    assert.equal(z.fromJSONSchema(batch).safeParse({ operations: [{ tool: 'upsert_scene_node', arguments: { id: 'n', description: 'new' } }] }).success, true);
  }
  assert.deepEqual(source, before);
});
