import assert from 'node:assert/strict';
import test from 'node:test';
import { completeCharacterDraft } from '../services/characterAssistant.js';
import {
  CHARACTER_WORLD_BOOK_PATCH_TOOL_NAMES,
  CHARACTER_WORLD_BOOK_READ_TOOL_NAMES,
  WORLD_BOOK_DRAFT_SCHEMA,
  WORLD_BOOK_DRAFT_TOOLS,
  createCharacterWorldBookTools
} from '../services/worldBookDraftTools.js';

const providerSettings = {
  providerType: 'custom',
  gatewayName: 'World Book Tools',
  baseUrl: 'https://character-world-book.test/v1',
  model: 'test-model',
  apiKey: 'test-key',
  extraBody: {}
};

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

// Replies with one tool call per round, in order.
function respondWithCalls(calls) {
  let round = 0;
  return async () => {
    const current = calls[round];
    round += 1;
    return Response.json({
      choices: [{
        message: {
          role: 'assistant',
          content: current ? null : 'done',
          tool_calls: current ? [current] : []
        }
      }]
    });
  };
}

function resultByTool(result, name) {
  return result.toolCalls.find((call) => call.name === name)?.result;
}

test('character world book tools reuse the standalone assistant definitions', () => {
  const tools = createCharacterWorldBookTools();
  const names = tools.map((tool) => tool.function.name);
  assert.deepEqual(names, [
    'create_character_world_book',
    ...CHARACTER_WORLD_BOOK_PATCH_TOOL_NAMES,
    ...CHARACTER_WORLD_BOOK_READ_TOOL_NAMES
  ]);

  // The shared tools are the very same objects the standalone assistant sends,
  // so neither assistant can drift into a different entry format.
  for (const name of [...CHARACTER_WORLD_BOOK_PATCH_TOOL_NAMES, ...CHARACTER_WORLD_BOOK_READ_TOOL_NAMES]) {
    const shared = WORLD_BOOK_DRAFT_TOOLS.find((tool) => tool.function.name === name);
    const character = tools.find((tool) => tool.function.name === name);
    assert.equal(character, shared, `${name} should be the shared tool definition`);
  }
  assert.deepEqual(
    tools[0].function.parameters.properties.entries,
    WORLD_BOOK_DRAFT_SCHEMA.properties.entries
  );
});

test('character assistant builds a world book draft with create, upsert, preview and remove', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = respondWithCalls([
      toolCall('c1', 'create_character_world_book', {
        name: '雾港航路',
        entries: [
          { name: '雾港', triggerKeys: '雾港,港口城邦', content: '雾港由领航公会治理。' },
          // Schema-valid but unusable: a non-permanent entry needs trigger keys.
          { name: '缺触发词', triggerKeys: '', content: '没有触发词的条目。' }
        ]
      }),
      toolCall('c2', 'upsert_world_book_entry', {
        changes: { name: '领航公会', triggerKeys: '领航公会,公会', content: '掌握航图的公会。', group: '港口' }
      }),
      toolCall('c3', 'preview_world_book_entries', { text: '我们在雾港见到了领航公会的人。' }),
      toolCall('c4', 'remove_world_book_entry', { entryId: 'does-not-exist' }),
      toolCall('c5', 'finish_character_draft', { summary: '世界书已建立。', reviewedSections: ['worldBook'] })
    ]);

    const result = await completeCharacterDraft(providerSettings, {
      requirement: '加入航海世界设定',
      current: { name: '雾岚' }
    });

    const created = resultByTool(result, 'create_character_world_book');
    assert.equal(created.ok, true);
    assert.equal(created.entryCount, 1);
    // Unusable entries are reported instead of silently disappearing.
    assert.equal(created.droppedEntries, 1);
    assert.match(created.message, /triggerKeys/);

    const upserted = resultByTool(result, 'upsert_world_book_entry');
    assert.equal(upserted.ok, true);
    assert.equal(upserted.entryCount, 2);

    const preview = resultByTool(result, 'preview_world_book_entries');
    assert.equal(preview.ok, true);
    assert.equal(preview.matchCount, 2);

    assert.equal(resultByTool(result, 'remove_world_book_entry').error, 'ENTRY_NOT_FOUND');

    const draft = result.character.worldBookDraft;
    assert.equal(draft.name, '雾港航路');
    assert.deepEqual(draft.entries.map((entry) => entry.name), ['雾港', '领航公会']);
    assert.equal(draft.entries[1].group, '港口');
    assert.ok(draft.entries.every((entry) => entry.id));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character world book patches require an existing draft and clear an emptied one', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = respondWithCalls([
      toolCall('p1', 'upsert_world_book_entry', {
        changes: { name: '孤立条目', triggerKeys: '孤立', content: '没有草稿时不应写入。' }
      }),
      toolCall('p2', 'create_character_world_book', {
        name: '临时设定',
        entries: [{ name: '唯一条目', triggerKeys: '唯一', content: '会被移除。' }]
      }),
      toolCall('p3', 'remove_world_book_entry', { entryId: 'PLACEHOLDER' }),
      toolCall('p4', 'finish_character_draft', { summary: '已清理。', reviewedSections: ['worldBook'] })
    ]);

    let result = await completeCharacterDraft(providerSettings, {
      requirement: '整理世界书',
      current: { name: '雾岚' }
    });

    const rejected = resultByTool(result, 'upsert_world_book_entry');
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, 'WORLD_BOOK_DRAFT_MISSING');

    // The removal used a placeholder id, so re-run with the real one to prove
    // that emptying the draft clears it instead of leaving an unsavable shell.
    const createdEntryId = result.character.worldBookDraft.entries[0].id;
    globalThis.fetch = respondWithCalls([
      toolCall('r1', 'create_character_world_book', {
        name: '临时设定',
        entries: [{ id: createdEntryId, name: '唯一条目', triggerKeys: '唯一', content: '会被移除。' }]
      }),
      toolCall('r2', 'remove_world_book_entry', { entryId: createdEntryId }),
      toolCall('r3', 'finish_character_draft', { summary: '已清理。', reviewedSections: ['worldBook'] })
    ]);
    result = await completeCharacterDraft(providerSettings, {
      requirement: '整理世界书',
      current: { name: '雾岚' }
    });

    const removed = resultByTool(result, 'remove_world_book_entry');
    assert.equal(removed.ok, true);
    assert.equal(removed.entryCount, 0);
    assert.equal(result.character.worldBookDraft, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character world book tools stay out of the tool list when the section is off', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const sentTools = [];
    globalThis.fetch = async (_url, request = {}) => {
      sentTools.push(JSON.parse(request.body).tools.map((tool) => tool.function.name));
      return Response.json({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [toolCall('f1', 'finish_character_draft', { summary: '无需世界书。', reviewedSections: [] })]
          }
        }]
      });
    };

    await completeCharacterDraft(providerSettings, {
      requirement: '只调整人设',
      current: { name: '雾岚' },
      options: { worldBook: false }
    });

    for (const name of [
      'create_character_world_book',
      ...CHARACTER_WORLD_BOOK_PATCH_TOOL_NAMES,
      ...CHARACTER_WORLD_BOOK_READ_TOOL_NAMES
    ]) {
      assert.equal(sentTools[0].includes(name), false, `${name} should not be offered`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
