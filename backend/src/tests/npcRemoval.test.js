import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAppDatabase } from '../db/runtime.js';
import { initializeDatabase } from '../db/schema.js';
import { createCharacter } from '../modules/characters.js';
import { normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { upsertSceneNode, upsertSceneItem, listSceneWorkspace, mergeSceneNodes, deleteSceneEntity } from '../modules/scenes.js';
import { captureConversationSnapshot, restoreConversationSnapshot } from '../repositories/conversationSnapshotRepository.js';
import { createConversationsRouter } from '../routes/conversations.js';
import { createDefaultJobHandlers } from '../services/jobs/jobHandlers.js';
import { submitJob } from '../services/jobs/jobQueue.js';
import { getGameplayDashboard } from '../modules/gameplayDashboard.js';
import { newId, nowIso } from '../security.js';
import { insertUser, withServer } from './routeTestUtils.js';

function fixture(t) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'removal-user';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Story character' });
  const conversationId = newId();
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId, userId, character.id, 'Story', nowIso(), nowIso());
  const node = upsertSceneNode(database, userId, conversationId, { name: 'Harbor', nodeType: 'main_scene' });
  return { database, userId, conversationId, character, node };
}

test('new databases and background handlers have no managed NPC domain', t => {
  const { database, userId, conversationId } = fixture(t);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
  assert.equal(tables.some(name => /^(?:cast_|npc_|hmdt_)/.test(name)), false);
  assert.equal(tables.includes('conversation_turns'), false);
  assert.equal(tables.includes('scene_objects'), true);
  assert.equal(tables.includes('encounters'), false);
  const handlers = createDefaultJobHandlers(database);
  assert.equal(Object.keys(handlers).some(name => name.startsWith('cast.')), false);
  assert.throws(() => submitJob(database, userId, 'cast.organize', { conversationId }, { idempotencyKey: 'removed' }),
    error => error.code === 'JOB_TYPE_UNSUPPORTED');
  assert.equal(Object.hasOwn(normalizeAdvancedSettings({ castTracking: { enabled: true } }), 'castTracking'), false);
  const dashboard = getGameplayDashboard(database, userId, conversationId);
  for (const key of ['presentNpcs', 'npcActivities', 'backpack', 'encounter']) assert.equal(Object.hasOwn(dashboard, key), false);
});

test('scene items remain editable, scoped and recoverable without character inventories', t => {
  const { database, userId, conversationId, node } = fixture(t);
  const item = upsertSceneItem(database, userId, conversationId, { nodeId: node.id, name: 'Key', itemCode: 'KEY', position: { x: 50 } });
  assert.throws(() => upsertSceneItem(database, userId, conversationId, { id: item.id, nodeId: 'missing', name: 'Bad' }),
    error => error.code === 'SCENE_NODE_INVALID');
  assert.throws(() => upsertSceneItem(database, 'another-user', conversationId, { id: item.id, name: 'Bad' }));
  const updated = upsertSceneItem(database, userId, conversationId, { id: item.id, revision: item.revision, quantity: 2 });
  assert.equal(updated.revision, item.revision + 1);
  assert.deepEqual(updated.position, { x: 50 });
  assert.throws(() => upsertSceneItem(database, userId, conversationId, { id: item.id, revision: item.revision, quantity: 3 }),
    error => error.code === 'SCENE_ITEM_REVISION_CONFLICT');
  const snapshot = captureConversationSnapshot(database, userId, conversationId);
  assert.equal(snapshot.state.scene_objects.length, 1);
  assert.equal(Object.keys(snapshot.state).some(name => name.startsWith('cast_')), false);
  assert.equal(deleteSceneEntity(database, userId, conversationId, 'node', node.id), false);
  const target = upsertSceneNode(database, userId, conversationId, { name: 'Market', nodeType: 'main_scene' });
  mergeSceneNodes(database, userId, conversationId, node.id, target.id);
  assert.equal(listSceneWorkspace(database, userId, conversationId).items[0].nodeId, target.id);
  restoreConversationSnapshot(database, userId, conversationId, snapshot);
  assert.equal(listSceneWorkspace(database, userId, conversationId).items[0].nodeId, node.id);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('upgrade copies only world scene items and preserves retired tables and migration identities', t => {
  const { database, userId, conversationId, node } = fixture(t);
  database.exec(`CREATE TABLE scene_items (
    id TEXT PRIMARY KEY, conversation_id TEXT, node_id TEXT, owner_kind TEXT,
    name TEXT, item_code TEXT, created_at TEXT, updated_at TEXT
  ); CREATE TABLE cast_members (id TEXT PRIMARY KEY, name TEXT);
  INSERT INTO cast_members VALUES ('historical-member', 'Untouched');
  INSERT INTO schema_migrations VALUES ('0021', 'historical-retired-migration', 'old-checksum', '2026-01-01');
  DELETE FROM schema_migrations WHERE version = '0027';`);
  const insert = database.prepare('INSERT INTO scene_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run('world-key', conversationId, node.id, 'world', 'World key', 'WORLD-KEY', nowIso(), nowIso());
  insert.run('owned-key', conversationId, node.id, 'member', 'Personal key', 'PERSONAL-KEY', nowIso(), nowIso());
  initializeDatabase(database);
  initializeDatabase(database);
  assert.deepEqual(listSceneWorkspace(database, userId, conversationId).items.map(item => item.id), ['world-key']);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM scene_items').get().count, 2);
  assert.equal(database.prepare('SELECT name FROM cast_members').get().name, 'Untouched');
  assert.equal(database.prepare("SELECT checksum FROM schema_migrations WHERE version = '0021'").get().checksum, 'old-checksum');
  const legacy = captureConversationSnapshot(database, userId, conversationId);
  legacy.state.scene_items = database.prepare("SELECT * FROM scene_items WHERE owner_kind = 'world'").all();
  delete legacy.state.scene_objects;
  restoreConversationSnapshot(database, userId, conversationId, legacy);
  assert.equal(listSceneWorkspace(database, userId, conversationId).items[0].name, 'World key');
});

test('removed conversation endpoints return 404 while scenes and gameplay still work', async t => {
  const { database, userId, conversationId } = fixture(t);
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({ db: database, newId, nowIso,
    requireAuth: (request, response, next) => { request.auth = { user: { id: userId } }; next(); },
    asyncRoute: handler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
  }));
  await withServer(app, async baseUrl => {
    for (const suffix of ['/cast', '/multi-role', '/gameplay/activities', '/gameplay/backpack', '/gameplay/encounters/active']) {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}${suffix}`);
      assert.equal(response.status, 404, suffix);
    }
    for (const suffix of ['/scenes', '/gameplay/dashboard', '/gameplay/quests']) {
      const response = await fetch(`${baseUrl}/api/conversations/${conversationId}${suffix}`);
      assert.equal(response.status, 200, suffix);
    }
  });
});
