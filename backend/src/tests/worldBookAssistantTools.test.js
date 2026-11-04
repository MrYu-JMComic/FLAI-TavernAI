import assert from 'node:assert/strict';
import test from 'node:test';
import { completeWorldBookDraft, streamWorldBookDraft } from '../services/worldBookAssistant.js';
import {
  WORLD_BOOK_DRAFT_SCHEMA,
  WORLD_BOOK_DRAFT_TOOLS,
  createCharacterWorldBookTool
} from '../services/worldBookDraftTools.js';
import { worldBookWorkspaceTools } from '../services/worldBooks/worldBookAssistantWorkspace.js';

const settings = { providerType: 'custom', gatewayName: 'Tool Test', baseUrl: 'https://world-tools.test/v1', model: 'test-model', apiKey: 'test-key', extraBody: {} };

for (const mode of [
  { streaming: false, providerType: 'custom' }, { streaming: true, providerType: 'custom' },
  { streaming: false, providerType: 'gemini' }, { streaming: true, providerType: 'gemini' }
]) {
  const { streaming, providerType } = mode;
  test(`world book ${providerType} ${streaming ? 'stream' : 'completion'} patches individual entries and previews the updated draft`, async () => {
    const originalFetch = globalThis.fetch;
    try {
      let round = 0;
      const requests = [];
      globalThis.fetch = async (_url, request) => {
        requests.push(JSON.parse(request.body));
        round += 1;
        const calls = round === 1 ? [
          ['upsert_world_book_entry', { entryId: 'gate-id', changes: { content: 'The gate opens at noon.', keysSecondary: 'noon', selective: true, selectiveLogic: 0 } }],
          ['upsert_world_book_entry', { changes: { name: 'Archive', triggerKeys: 'archive', content: 'A quiet archive.' } }],
          ['remove_world_book_entry', { entryId: 'obsolete-id' }]
        ] : round === 2 ? [['preview_world_book_entries', { text: 'The gate at noon.' }]] : [];
        return Response.json({ choices: [{ message: {
          role: 'assistant', content: calls.length ? null : 'Done.',
          tool_calls: calls.map(([name, args], index) => ({ id: `call-${round}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }))
        } }] });
      };
      const current = { name: 'Existing book', entries: [
        { id: 'gate-id', name: 'Gate', triggerKeys: 'gate', content: 'The gate opens at night.', sticky: 3, role: 2, position: 'at_depth' },
        { id: 'keep-id', name: 'Keep', triggerKeys: 'keep', content: 'Unchanged lore.', alwaysActive: true },
        { id: 'obsolete-id', name: 'Obsolete', triggerKeys: 'old', content: 'Old lore.' }
      ] };
      const providerSettings = { ...settings, providerType };
      const result = streaming
        ? await streamWorldBookDraft(providerSettings, { current, requirement: 'Update gate, add archive and remove obsolete lore.' })
        : await completeWorldBookDraft(providerSettings, { current, requirement: 'Update gate, add archive and remove obsolete lore.' });
      assert.equal(round, 3);
      assert.ok(requests[0].tools.some((tool) => tool.function.name === 'upsert_world_book_entry'));
      const roleSchema = requests[0].tools.find((tool) => tool.function.name === 'upsert_world_book_entry')
        .function.parameters.properties.changes.properties.role;
      assert.equal(roleSchema.type, 'integer');
      assert.deepEqual(roleSchema.enum, [0, 1, 2]);
      const entryProperties = requests[0].tools.find((tool) => tool.function.name === 'replace_world_book_entries')
        .function.parameters.properties.entries.items.properties;
      assert.equal(entryProperties.name.maxLength, 100);
      assert.equal(entryProperties.triggerKeys.maxLength, 2000);
      assert.equal(entryProperties.content.maxLength, 50000);
      assert.equal(entryProperties.group.maxLength, 100);
      assert.equal(Object.hasOwn(entryProperties, 'inclusionGroup'), false);
      assert.ok(result.toolCalls.every((call) => call.result.ok), JSON.stringify(result.toolCalls));
      const gate = result.worldBook.entries.find((entry) => entry.id === 'gate-id');
      assert.equal(gate.content, 'The gate opens at noon.');
      assert.equal(gate.sticky, 3);
      assert.equal(gate.role, 2);
      assert.equal(gate.keysSecondary, 'noon');
      const kept = result.worldBook.entries.find((entry) => entry.id === 'keep-id');
      assert.equal(kept.content, 'Unchanged lore.');
      assert.equal(kept.triggerKeys, 'keep');
      assert.ok(result.worldBook.entries.some((entry) => entry.name === 'Archive' && entry.id));
      assert.ok(!result.worldBook.entries.some((entry) => entry.id === 'obsolete-id'));
      const preview = result.toolCalls.at(-1).result;
      assert.ok(preview.matches.some((entry) => entry.id === 'gate-id'));
      assert.equal(current.entries[0].content, 'The gate opens at night.');
      assert.equal(current.entries.length, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test('world book profile and invalid patch calls cannot replace or clear unrelated entries', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let round = 0;
    globalThis.fetch = async () => {
      round += 1;
      const calls = round === 1 ? [
        ['set_world_book_profile', { name: 'Changed', entries: [] }],
        ['upsert_world_book_entry', { entryId: 'missing-id', changes: { content: 'Unknown' } }],
        ['upsert_world_book_entry', { entryId: 'known-id', changes: { content: '' } }]
      ] : [];
      return Response.json({ choices: [{ message: {
        role: 'assistant', content: calls.length ? null : 'No changes.',
        tool_calls: calls.map(([name, args], index) => ({ id: `invalid-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }))
      } }] });
    };
    const result = await completeWorldBookDraft(settings, { current: { name: 'Original', entries: [{ id: 'known-id', name: 'Lore', triggerKeys: 'lore', content: 'Preserve this.' }] } });
    assert.equal(result.worldBook.name, 'Original');
    assert.equal(result.worldBook.entries[0].content, 'Preserve this.');
    assert.ok(result.toolCalls.every((call) => call.result.ok === false));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character and standalone world book assistants share the exact draft schema', () => {
  const characterTool = createCharacterWorldBookTool();
  const replacementTool = WORLD_BOOK_DRAFT_TOOLS.find((tool) => tool.function.name === 'replace_world_book_entries');

  assert.deepEqual(characterTool.function.parameters, WORLD_BOOK_DRAFT_SCHEMA);
  assert.deepEqual(
    characterTool.function.parameters.properties.entries,
    replacementTool.function.parameters.properties.entries
  );
  assert.match(characterTool.function.description, /does not write to the database/);
});

test('fixed world-book tool descriptions and quality instructions are English', async () => {
  const { WORLD_BOOK_QUALITY_INSTRUCTIONS } = await import('../services/worldBookDraftTools.js');
  const tools = [...WORLD_BOOK_DRAFT_TOOLS, ...worldBookWorkspaceTools(), createCharacterWorldBookTool()];
  const descriptions = [];
  const collect = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.description === 'string') descriptions.push(value.description);
    for (const child of Object.values(value)) collect(child);
  };
  tools.forEach(collect);
  descriptions.push(...WORLD_BOOK_QUALITY_INSTRUCTIONS);

  assert.ok(descriptions.length > 0);
  for (const description of descriptions) assert.doesNotMatch(description, /\p{Script=Han}/u);
});

function worldBookToolResponse(calls, round) {
  return Response.json({ choices: [{ message: {
    role: 'assistant', content: calls.length ? null : 'Done.',
    tool_calls: calls.map(([name, args], index) => ({ id: `rt-${round}-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }))
  } }] });
}

const thinkingSettings = { providerType: 'deepseek', gatewayName: 'DeepSeek', baseUrl: 'https://world-tools.test', model: 'deepseek-flash', apiKey: 'sk-test', supportsReasoning: true, extraBody: {} };
const loreEntry = { name: 'Harbor', triggerKeys: 'harbor', content: 'A foggy harbor.' };

test('world book assistant forwards thinking and honours stable mode on the stream route', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  try {
    globalThis.fetch = async (_url, request) => {
      requests.push(JSON.parse(request.body));
      const calls = requests.length === 1 ? [['replace_world_book_entries', { entries: [loreEntry] }]] : [];
      return worldBookToolResponse(calls, requests.length);
    };
    const result = await streamWorldBookDraft(thinkingSettings, {
      requirement: 'Harbor lore',
      thinkingLevel: 'high',
      providerStreaming: false,
      emit: (event, data) => events.push({ event, data })
    });
    assert.notEqual(requests[0].stream, true);
    assert.equal(requests[0].thinking.type, 'enabled');
    assert.equal(requests[0].reasoning_effort, 'high');
    assert.equal(result.worldBook.entries[0].name, 'Harbor');
    assert.ok(events.some(({ event }) => event === 'step'));
    assert.ok(events.some(({ event, data }) => event === 'tool' && data.name === 'replace_world_book_entries'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book context limits rounds, entries and can ignore the current book', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (_url, request) => {
      requests.push(JSON.parse(request.body));
      const calls = requests.length === 1
        ? [['replace_world_book_entries', { entries: [loreEntry, { ...loreEntry, name: 'Second', triggerKeys: 'second' }] }]]
        : [['upsert_world_book_entry', { changes: loreEntry }]];
      return worldBookToolResponse(calls, requests.length);
    };
    const result = await completeWorldBookDraft(settings, {
      requirement: 'Fresh harbor book',
      current: { name: 'Old book', entries: [{ id: 'old', name: 'Old', triggerKeys: 'old', content: 'Old lore.' }] },
      context: { useCurrent: false, maxRounds: 2, entryLimit: 1 }
    });
    assert.equal(requests.length, 2);
    assert.equal(JSON.parse(requests[0].messages[1].content).currentWorldBook, null);
    assert.match(requests[0].messages[0].content, /The total number of entries must not exceed 1/);
    assert.doesNotMatch(requests[0].messages[0].content, /\p{Script=Han}/u);
    assert.equal(result.toolCalls[0].result.error, 'ENTRY_LIMIT');
    assert.deepEqual(result.worldBook.entries.map((entry) => entry.name), ['Harbor']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world book plan phase is read-only and execution tracks the approved plan', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return worldBookToolResponse(requests.length === 1
        ? [['submit_world_book_plan', { steps: [{ section: 'entries', intent: '写入港口条目' }] }]]
        : [], requests.length);
    };
    const planned = await completeWorldBookDraft(settings, {
      requirement: 'Harbor',
      current: { name: 'Keep', entries: [{ id: 'k', name: 'K', triggerKeys: 'k', content: 'Keep.' }] },
      planMode: true
    });
    assert.deepEqual(requests[0].tools.map((tool) => tool.function.name).sort(), ['preview_world_book_entries', 'submit_world_book_plan']);
    assert.equal(planned.phase, 'plan');
    assert.equal(Object.hasOwn(planned, 'worldBook'), false);
    assert.deepEqual(planned.plan.steps.map((step) => step.section), ['entries']);

    requests.length = 0;
    globalThis.fetch = async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return worldBookToolResponse(requests.length === 1 ? [['upsert_world_book_entry', { changes: loreEntry }]] : [], requests.length);
    };
    const executed = await completeWorldBookDraft(settings, {
      requirement: 'Harbor',
      current: { name: 'Keep', entries: [] },
      planMode: true,
      plan: { approved: true, steps: planned.plan.steps }
    });
    assert.match(requests[0].messages[0].content, /Plan step 1 \(entries\): 写入港口条目/);
    assert.equal(executed.toolCalls[0].result.workflow.plan.completed, 1);
    assert.equal(executed.planProgress.completed, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
