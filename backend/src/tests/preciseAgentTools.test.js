import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-precise-agent-tools';
const { createAppDatabase } = await import('../db/runtime.js');
const { insertUser } = await import('./routeTestUtils.js');
const { createCharacter } = await import('../modules/characters.js');
const { nowIso, newId } = await import('../security.js');
const { upsertSceneNode, upsertSceneRoute, listSceneWorkspace } = await import('../modules/scenes.js');
const { buildSceneOrganizerTools, executeSceneOrganizerTool } = await import('../services/sceneOrganizer.js');
const { executeProviderTool } = await import('../services/providerToolResults.js');
const { createEntry, createWorldBook, getWorldBook } = await import('../services/worldBooks/worldBookService.js');
const { completeWorldBookDraft, streamWorldBookDraft } = await import('../services/worldBookAssistant.js');
const { completeCharacterDraft } = await import('../services/characterAssistant.js');
const { buildWorldBookChanges, createWorldBookWorkspace, executeWorldBookWorkspaceTool, serializeWorldBookWorkspace, worldBookWorkspaceTools } = await import('../services/worldBooks/worldBookAssistantWorkspace.js');
const { PIXEL_ICON_KEYS } = await import('../../../shared/pixelIconCatalog.js');

function fixture(t) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'precise-owner';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Traveler' });
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId, userId, character.id, 'Precision', timestamp, timestamp);
  return { database, userId, conversationId, changes: [] };
}

async function scene(state, name, args) {
  return (await executeProviderTool((tool, values) => executeSceneOrganizerTool(state, tool, values), name, args, {}, undefined, buildSceneOrganizerTools())).result;
}

test('scene sparse updates and exact patches retain identity, metadata and omitted route endpoints', async t => {
  const state = fixture(t);
  const node = upsertSceneNode(state.database, state.userId, state.conversationId, {
    name: 'North Gate', nodeType: 'main_scene', description: 'Old stone. Keep the bell.', tags: ['guarded'],
    layout: { x: 20, y: 40, legacyHint: 'retain' }
  });
  const other = upsertSceneNode(state.database, state.userId, state.conversationId, { name: 'Road', nodeType: 'map' });
  const route = upsertSceneRoute(state.database, state.userId, state.conversationId, { fromNodeId: node.id, toNodeId: other.id, label: 'Road', description: 'Old route.', bidirectional: false });
  const changed = await scene(state, 'upsert_scene_node', { id: node.id, layout: { x: 35 } });
  assert.equal(changed.ok, true);
  assert.deepEqual(changed.node.layout, { x: 35, y: 40, legacyHint: 'retain' });
  assert.equal(changed.node.name, node.name);
  assert.equal(changed.node.nodeType, node.nodeType);
  assert.deepEqual(changed.node.tags, ['guarded']);
  assert.equal((await scene(state, 'patch_scene_text', { entityType: 'node', id: node.id, field: 'description', oldText: 'Old stone.', newText: 'Repaired stone.' })).ok, true);
  const changedRoute = await scene(state, 'upsert_scene_route', { id: route.id, label: 'Guarded road' });
  assert.equal(changedRoute.ok, true);
  assert.equal(changedRoute.route.fromNodeId, node.id);
  assert.equal(changedRoute.route.toNodeId, other.id);
  assert.equal(changedRoute.route.bidirectional, false);
  assert.equal(changedRoute.route.description, 'Old route.');
  const before = listSceneWorkspace(state.database, state.userId, state.conversationId);
  const rejected = await scene(state, 'patch_scene_text', { entityType: 'node', id: node.id, field: 'description', oldText: 'missing', newText: 'bad' });
  assert.equal(rejected.error, 'TEXT_PATCH_CONFLICT');
  assert.deepEqual(listSceneWorkspace(state.database, state.userId, state.conversationId), before);
  assert.equal((await scene(state, 'upsert_scene_node', { id: node.id })).error, 'SCENE_NO_CHANGES');
  assert.equal((await scene(state, 'upsert_scene_node', { name: 'Incomplete' })).error, 'SCENE_CREATE_FIELDS_REQUIRED');
});

test('scene batch rolls back domain rows, audit events and published changes on a later failure', async t => {
  const state = fixture(t);
  const node = upsertSceneNode(state.database, state.userId, state.conversationId, { name: 'Gate', nodeType: 'main_scene', description: 'Before' });
  const before = listSceneWorkspace(state.database, state.userId, state.conversationId);
  const eventCount = state.database.prepare('SELECT COUNT(*) AS count FROM world_events').get().count;
  const failed = await scene(state, 'batch_scene_changes', { operations: [
    { tool: 'upsert_scene_node', arguments: { id: node.id, description: 'Should roll back' } },
    { tool: 'upsert_scene_route', arguments: { fromNodeId: node.id, toNodeId: 'missing-node' } }
  ] });
  assert.equal(failed.ok, false);
  assert.equal(failed.operationIndex, 1);
  assert.deepEqual(listSceneWorkspace(state.database, state.userId, state.conversationId), before);
  assert.equal(state.database.prepare('SELECT COUNT(*) AS count FROM world_events').get().count, eventCount);
  assert.deepEqual(state.changes, []);
});

test('scene batch can connect explicitly identified new nodes in a single atomic operation', async t => {
  const state = fixture(t);
  const layout = { x: 10, y: 10, iconKey: PIXEL_ICON_KEYS[0] };
  const result = await scene(state, 'batch_scene_changes', { operations: [
    { tool: 'upsert_scene_node', arguments: { id: 'place-a', name: 'Gate', nodeType: 'main_scene', layout } },
    { tool: 'upsert_scene_node', arguments: { id: 'place-b', name: 'Road', nodeType: 'map', layout: { ...layout, x: 70 } } },
    { tool: 'upsert_scene_route', arguments: { id: 'route-ab', fromNodeId: 'place-a', toNodeId: 'place-b', label: 'Open road' } }
  ] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const workspace = listSceneWorkspace(state.database, state.userId, state.conversationId);
  assert.equal(workspace.nodes.length, 2);
  assert.equal(workspace.routes[0].id, 'route-ab');
  assert.equal(state.changes.length, 3);
});

function bookFixture(t) {
  const state = fixture(t);
  const book = createWorldBook(state.database, state.userId, { name: 'Sea', description: 'Keep profile' });
  const entry = createEntry(state.database, state.userId, book.id, {
    name: 'Harbor', triggerKeys: 'harbor', content: 'Old dock. Keep this paragraph. Old dock.', enabled: false,
    position: 'at_depth', depth: 7, role: 2, sticky: 4, group: 'Fleet'
  });
  return { ...state, book, entry, workspace: createWorldBookWorkspace({ ...state, selectedBookIds: [book.id] }) };
}

async function worldBook(workspace, name, args) {
  return (await executeProviderTool((tool, values) => executeWorldBookWorkspaceTool(workspace, tool, values), name, args, {}, undefined, worldBookWorkspaceTools())).result;
}

test('world-book exact body edits preserve metadata and reject a stale later edit atomically', async t => {
  const { database, userId, book, entry, workspace } = bookFixture(t);
  const original = getWorldBook(database, userId, book.id);
  const changed = await worldBook(workspace, 'patch_world_book_text', { edits: [{ entryId: entry.id, oldText: 'Old dock.', newText: 'New dock.', expectedOccurrences: 2 }] });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  const [change] = buildWorldBookChanges(workspace);
  assert.deepEqual(change.upserts[0].patch, { content: 'New dock. Keep this paragraph. New dock.' });
  assert.equal(change.upserts[0].before.group, 'Fleet');
  assert.equal(change.upserts[0].before.sticky, 4);
  assert.equal(change.upserts[0].before.enabled, false);
  const before = serializeWorldBookWorkspace(workspace);
  const failed = await worldBook(workspace, 'patch_world_book_text', { edits: [
    { entryId: entry.id, oldText: 'Keep this paragraph.', newText: 'Should roll back.' },
    { entryId: entry.id, oldText: 'Old dock.', newText: 'Stale', expectedOccurrences: 2 }
  ] });
  assert.equal(failed.error, 'TEXT_PATCH_CONFLICT');
  assert.equal(failed.operationIndex, 1);
  assert.deepEqual(serializeWorldBookWorkspace(workspace), before);
  assert.deepEqual(getWorldBook(database, userId, book.id), original);
});

test('world-book mixed batches preserve sparse values and roll back when a later target is missing', async t => {
  const { database, userId, book, entry } = bookFixture(t);
  const remove = createEntry(database, userId, book.id, { name: 'Remove', triggerKeys: 'remove', content: 'Obsolete' });
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  const failedBefore = serializeWorldBookWorkspace(workspace);
  const failed = await worldBook(workspace, 'batch_world_book_entries', { operations: [
    { op: 'upsert', entryId: entry.id, changes: { name: 'Uncommitted' } },
    { op: 'remove', entryId: 'missing' }
  ] });
  assert.equal(failed.ok, false);
  assert.equal(failed.operationIndex, 1);
  assert.deepEqual(serializeWorldBookWorkspace(workspace), failedBefore);
  const result = await worldBook(workspace, 'batch_world_book_entries', { operations: [
    { op: 'upsert', entryId: entry.id, changes: { name: 'New harbor' } },
    { op: 'remove', entryId: remove.id },
    { op: 'upsert', changes: { name: 'Lighthouse', triggerKeys: 'light', content: 'A new light' } }
  ] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const [change] = buildWorldBookChanges(workspace);
  assert.deepEqual(change.upserts.find(item => item.entryId === entry.id).patch, { name: 'New harbor' });
  assert.equal(change.upserts.filter(item => item.localId).length, 1);
  assert.deepEqual(change.removals, [remove.id]);
  assert.equal(getWorldBook(database, userId, book.id).entries.length, 2);
});

test('assistant counts batch additions toward the existing per-run generation limit', async t => {
  const { database, userId, book, entry } = bookFixture(t);
  const originalFetch = globalThis.fetch;
  try {
  const response = calls => Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: calls.map(([name, args], index) => ({ id: `limit-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] });
  let round = 0;
  globalThis.fetch = async () => ++round === 1 ? response([
    ['batch_world_book_entries', { operations: [
      { op: 'upsert', entryId: entry.id, changes: { name: 'Updated' } },
      { op: 'upsert', changes: { name: 'First', triggerKeys: 'first', content: 'First new entry' } }
    ] }],
    ['batch_world_book_entries', { operations: [{ op: 'upsert', changes: { name: 'Excess', triggerKeys: 'excess', content: 'Must be rejected' } }] }],
    ['finish_world_book_task', { reply: 'Done' }]
  ]) : response([]);
  const settings = { providerType: 'custom', gatewayName: 'Batch limit', baseUrl: 'https://batch-limit.test/v1', model: 'mock', apiKey: 'test', extraBody: {} };
  const result = await completeWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], context: { entryLimit: 1 } });
  assert.equal(result.toolCalls[0].result.ok, true);
  assert.equal(result.toolCalls[1].result.error, 'ENTRY_LIMIT');
  assert.equal(result.changes[0].upserts.length, 2);
  assert.equal(round, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('world-book stream recovery replays a successful mixed creation batch without duplicate entries', async t => {
  const { database, userId, book, entry } = bookFixture(t);
  const originalFetch = globalThis.fetch;
  try {
  const batch = { operations: [
    { op: 'upsert', entryId: entry.id, changes: { name: 'Recovered harbor' } },
    { op: 'upsert', changes: { name: 'Lighthouse', triggerKeys: 'light', content: 'A single light' } }
  ] };
  const response = (id, name, args) => Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [
    { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
  ] } }] });
  let round = 0;
  globalThis.fetch = async (_url, request) => {
    round += 1;
    if (round === 1) return response('initial-batch', 'batch_world_book_entries', batch);
    if (round === 2) throw new Error('AI 流式响应中断');
    assert.equal(JSON.parse(request.body).stream, false);
    if (round === 3) return response('recovery-batch', 'batch_world_book_entries', batch);
    return response('finish', 'finish_world_book_task', { reply: 'Recovered' });
  };
  const settings = { providerType: 'custom', gatewayName: 'Batch recovery', baseUrl: 'https://batch-recovery.test/v1', model: 'mock', apiKey: 'test', extraBody: {} };
  const result = await streamWorldBookDraft(settings, { database, userId, selectedBookIds: [book.id], emit: () => {} });
  assert.equal(result.streamRecovered, true);
  assert.equal(result.toolCalls[0].result.replayed, true);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].upserts.length, 2);
  assert.equal(result.changes[0].upserts.filter(item => item.localId).length, 1);
  assert.equal(getWorldBook(database, userId, book.id).entries.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('character assistant uses the shared exact and batch tools within its enabled world-book scope', async t => {
  const { database, userId, book, entry } = bookFixture(t);
  const originalFetch = globalThis.fetch;
  try {
  const response = calls => Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: calls.map(([name, args], index) => ({ id: `character-precision-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } }] });
  globalThis.fetch = async (_url, request) => {
    const names = JSON.parse(request.body).tools.map(tool => tool.function.name);
    assert.ok(names.includes('patch_world_book_text'));
    assert.ok(names.includes('batch_world_book_entries'));
    return response([
      ['patch_world_book_text', { edits: [{ entryId: entry.id, oldText: 'Old dock.', newText: 'Restored dock.', expectedOccurrences: 2 }] }],
      ['batch_world_book_entries', { operations: [
        { op: 'upsert', entryId: entry.id, changes: { name: 'Restored harbor' } },
        { op: 'upsert', changes: { name: 'Light', triggerKeys: 'light', content: 'A light' } }
      ] }],
      ['finish_character_draft', { summary: 'Updated', reviewedSections: ['worldBook'] }]
    ]);
  };
  const settings = { providerType: 'custom', gatewayName: 'Character precision', baseUrl: 'https://character-precision.test/v1', model: 'mock', apiKey: 'test', extraBody: {} };
  const result = await completeCharacterDraft(settings, { database, userId, requirement: 'Restore harbor', worldBookContext: { selectedBookIds: [book.id] } });
  assert.equal(result.toolCalls[0].result.ok, true);
  assert.equal(result.toolCalls[1].result.ok, true);
  const [change] = result.character.worldBookChanges;
  assert.deepEqual(change.upserts.find(item => item.entryId === entry.id).patch,
    { content: 'Restored dock. Keep this paragraph. Restored dock.', name: 'Restored harbor' });
  assert.equal(change.upserts.filter(item => item.localId).length, 1);
  assert.equal(getWorldBook(database, userId, book.id).entries[0].name, 'Harbor');

  globalThis.fetch = async (_url, request) => {
    const names = JSON.parse(request.body).tools.map(tool => tool.function.name);
    assert.ok(!names.includes('patch_world_book_text'));
    assert.ok(!names.includes('batch_world_book_entries'));
    return response([['finish_character_draft', { summary: 'Read only', reviewedSections: ['profile'] }]]);
  };
  const disabled = await completeCharacterDraft(settings, { database, userId, options: { worldBook: false }, current: { name: 'Traveler' } });
  assert.equal(disabled.character.worldBookChanges, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
