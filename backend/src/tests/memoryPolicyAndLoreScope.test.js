import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAppDatabase } from '../db/runtime.js';
import { createCharacter } from '../modules/characters.js';
import { normalizeAccessorySkills, sanitizeAuthorAdvancedSettings } from '../modules/advancedSettings.js';
import { createConversationSettingsRouter } from '../routes/conversationSettings.js';
import { migrateWorldBookKnowledgeScope } from '../db/migrations/0033WorldBookKnowledgeScope.js';
import { createEntry, createWorldBook, getWorldBook, updateEntry } from '../services/worldBooks/worldBookService.js';
import { matchWorldBookEntries } from '../services/worldBooks/worldBookRuntime.js';
import { buildWorldBookMatchPreview } from '../services/worldBooks/worldBookMatchPreview.js';
import { insertUser, withServer } from './routeTestUtils.js';

function fixture(t, authorAdvancedSettings = {}) {
  const db = createAppDatabase(':memory:');
  migrateWorldBookKnowledgeScope(db);
  t.after(() => db.close());
  const userId = 'memory-policy-owner';
  insertUser(db, userId);
  const character = createCharacter(db, userId, { name: '阿青', authorAdvancedSettings });
  db.prepare('INSERT INTO conversations (id,user_id,character_id,title,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run('story', userId, character.id, '港口', '2026-11-01', '2026-11-01');
  return { db, userId, character };
}

test('memory policy partial overrides inherit independent defaults and public cards cannot grant calls', () => {
  const author = normalizeAccessorySkills({ memoryAgent: { memoryPolicy: { summaryEnabled: false, recallLimit: 12 }, embedding: { enabled: true, providerProfileId: 'private-profile' } } });
  const result = normalizeAccessorySkills({ memoryAgent: { memoryPolicy: { isolation: 'actor', actorId: 'actor-1' } } }, author);
  assert.equal(result.memoryAgent.memoryPolicy.summaryEnabled, false);
  assert.equal(result.memoryAgent.memoryPolicy.recallLimit, 12);
  assert.equal(result.memoryAgent.memoryPolicy.actorId, 'actor-1');
  const publicSettings = sanitizeAuthorAdvancedSettings({ accessorySkills: author });
  assert.equal(publicSettings.accessorySkills.memoryAgent.enabled, false);
  assert.equal(publicSettings.accessorySkills.memoryAgent.providerProfileId, undefined);
  assert.equal(publicSettings.accessorySkills.memoryAgent.embedding, undefined);
});

test('changing one memory override preserves inheritance; restoring removes the override', async (t) => {
  const { db, userId } = fixture(t, { accessorySkills: { memoryAgent: { memoryPolicy: { summaryEnabled: false, recallLimit: 9 } }, economyAgent: { enabled: true } } });
  const app = express();
  app.use(express.json());
  app.use('/api/conversations/:id', createConversationSettingsRouter({ db, requireAuth(request, _response, next) { request.auth = { user: { id: userId } }; next(); } }));
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/conversations/story/accessory-skills`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessorySkills: { memoryAgent: { memoryPolicy: { recallLimit: 18 } } } }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.skills.memoryAgent.memoryPolicy.summaryEnabled, false);
    assert.equal(result.skills.memoryAgent.memoryPolicy.recallLimit, 18);
    const stored = JSON.parse(db.prepare('SELECT user_advanced_settings FROM conversations WHERE id=?').get('story').user_advanced_settings);
    assert.deepEqual(stored.accessorySkills, { memoryAgent: { memoryPolicy: { recallLimit: 18 } } });
    const invalid = await fetch(`${baseUrl}/api/conversations/story/accessory-skills`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessorySkills: { memoryAgent: { embedding: { dimensions: 7 } } } }) });
    assert.equal(invalid.status, 400);
    const restore = await fetch(`${baseUrl}/api/conversations/story/accessory-skills`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ restoreInheritance: ['memoryAgent'] }) });
    assert.equal(restore.status, 200);
    assert.equal((await restore.json()).skills.memoryAgent.memoryPolicy.recallLimit, 9);
    assert.deepEqual(JSON.parse(db.prepare('SELECT user_advanced_settings FROM conversations WHERE id=?').get('story').user_advanced_settings).accessorySkills, {});
  });
});

test('strict lore filters hidden and recursive sources before trigger state, while preview is read-only', (t) => {
  const { db, userId, character } = fixture(t);
  const book = createWorldBook(db, userId, { name: '港口秘密', characterId: character.id });
  const hidden = createEntry(db, userId, book.id, { name: '秘密', triggerKeys: '钥匙', content: '灯塔的密码是玄鲸。', sticky: 3 });
  const publicEntry = createEntry(db, userId, book.id, { name: '潮汐', triggerKeys: '港口', content: '港口每天涨潮。', knowledgeVisibility: 'public' });
  const restricted = createEntry(db, userId, book.id, { name: '暗号', triggerKeys: '港口', content: '阿青知晓暗号。', knowledgeVisibility: 'restricted', audienceCastKeys: ['captain-aqing'] });
  const scope = { isolation: 'actor', actorCastKeys: ['captain-aqing'] };
  const options = { conversationId: 'story', knowledgeScope: scope };
  const preview = buildWorldBookMatchPreview(getWorldBook(db, userId, book.id), { text: '港口 钥匙', knowledgeScope: scope });
  assert.deepEqual(new Set(preview.effectiveMatches.map((entry) => entry.id)), new Set([publicEntry.id, restricted.id]));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversation_world_book_state').get().n, 0);
  const matches = matchWorldBookEntries(db, character.id, ['港口 钥匙'], options);
  assert.deepEqual(new Set(matches.map((entry) => entry.id)), new Set([publicEntry.id, restricted.id]));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversation_world_book_state WHERE entry_id=?').get(hidden.id).n, 0);
  const otherActor = matchWorldBookEntries(db, character.id, ['港口 钥匙'], { ...options, knowledgeScope: { isolation: 'actor', actorCastKeys: ['xiaoxue'] } });
  assert.deepEqual(otherActor.map((entry) => entry.id), [publicEntry.id]);
  const revised = updateEntry(db, userId, book.id, restricted.id, { knowledgeVisibility: 'public', audienceCastKeys: [] });
  assert.equal(revised.knowledgeVisibility, 'public');
  assert.deepEqual(revised.audienceCastKeys, []);
});
