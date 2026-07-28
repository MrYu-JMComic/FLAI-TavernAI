import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-npc-context-tools';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const {
  addNpcBehavior,
  addNpcMemory,
  buildNpcRosterPrompt,
  listConversationNpcRoster,
  resolveConversationNpcReference,
  upsertConversationNpc
} = await import('../modules/npcs.js');
const { upsertSceneItem } = await import('../modules/scenes.js');
const { attachNpcLookupTools, executeNpcLookupTool } = await import('../services/npcContextTools.js');
const { insertUser } = await import('./routeTestUtils.js');

test('NPC roster lists canonical names and aliases without profile details', () => {
  const env = setupNpcContext();
  const roster = listConversationNpcRoster(env.db, env.userId, env.conversationId, env.character.name);
  const prompt = buildNpcRosterPrompt(roster);

  assert.deepEqual(roster, [
    { name: 'Item Keeper', aliases: [], names: ['Item Keeper'] },
    { name: 'Mira Valen', aliases: ['Mira', 'Little Mi'], names: ['Mira Valen', 'Mira', 'Little Mi'] }
  ]);
  assert.match(prompt, /Mira Valen/);
  assert.match(prompt, /Little Mi/);
  assert.equal(prompt.includes('Old bridge secret'), false);
  assert.equal(prompt.includes('North watchtower'), false);
  assert.equal(prompt.includes('Rings the warning bell'), false);

  const resolution = resolveConversationNpcReference(
    env.db,
    env.userId,
    env.conversationId,
    'Little Mi',
    env.character.name
  );
  assert.equal(resolution.ok, true);
  assert.equal(resolution.npc.name, 'Mira Valen');
  assert.equal(resolution.resolvedFrom, 'Little Mi');
  assert.equal('summary' in resolution, false);
});

test('NPC lookup tools resolve aliases and fetch only the requested detail type', async () => {
  const env = setupNpcContext();
  const context = {
    db: env.db,
    userId: env.userId,
    conversationId: env.conversationId,
    mainCharacterName: env.character.name
  };

  const profile = executeNpcLookupTool(context, 'get_npc_profile', { npcName: 'Little Mi' });
  assert.equal(profile.ok, true);
  assert.equal(profile.npc.name, 'Mira Valen');
  assert.equal(profile.npc.currentLocation, 'North watchtower');
  assert.equal(profile.npc.relationship, 'Trusts Hero');
  assert.equal('memories' in profile, false);

  const memories = executeNpcLookupTool(context, 'get_npc_memories', { npcName: 'Mira' });
  assert.equal(memories.ok, true);
  assert.deepEqual(memories.memories.map((memory) => memory.content), ['Old bridge secret']);

  const behaviors = executeNpcLookupTool(context, 'get_npc_behaviors', { npcName: 'Mira Valen' });
  assert.equal(behaviors.ok, true);
  assert.deepEqual(behaviors.behaviors.map((behavior) => behavior.action), ['Rings the warning bell']);

  const items = executeNpcLookupTool(context, 'get_actor_items', { ownerType: 'npc', npcName: 'Mira' });
  assert.equal(items.ok, true);
  assert.deepEqual(items.items.map((item) => item.name), ['Silver key']);

  const roster = listConversationNpcRoster(env.db, env.userId, env.conversationId, env.character.name);
  const attached = attachNpcLookupTools({ thinkingEnabled: true }, { ...context, enabled: true, roster });
  assert.equal(attached.maxRounds, 4);
  assert.deepEqual(attached.tools.map((tool) => tool.function.name), [
    'get_npc_profile',
    'get_npc_memories',
    'get_npc_behaviors',
    'get_actor_items'
  ]);
  assert.equal((await attached.executeTool('get_npc_profile', { npcName: 'Mira' })).npc.name, 'Mira Valen');
});

test('NPC reference resolution prefers canonical names and reports ambiguous aliases', () => {
  const env = setupNpcContext();
  upsertConversationNpc(env.db, env.userId, env.conversationId, {
    npcName: 'Mira',
    aliases: ['Exact Mira']
  });
  upsertConversationNpc(env.db, env.userId, env.conversationId, {
    npcName: 'Rhea',
    aliases: ['Scout']
  });
  upsertConversationNpc(env.db, env.userId, env.conversationId, {
    npcName: 'Tala',
    aliases: ['Scout']
  });

  const canonical = resolveConversationNpcReference(
    env.db,
    env.userId,
    env.conversationId,
    'Mira',
    env.character.name
  );
  const ambiguous = resolveConversationNpcReference(
    env.db,
    env.userId,
    env.conversationId,
    'Scout',
    env.character.name
  );

  assert.equal(canonical.ok, true);
  assert.equal(canonical.npc.name, 'Mira');
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error, 'NPC_ALIAS_AMBIGUOUS');
  assert.deepEqual(ambiguous.candidates, ['Rhea', 'Tala']);
});

test('actor item lookup rejects missing or unsupported owner types', () => {
  const env = setupNpcContext();
  const context = {
    db: env.db,
    userId: env.userId,
    conversationId: env.conversationId,
    mainCharacterName: env.character.name
  };

  const missing = executeNpcLookupTool(context, 'get_actor_items', { npcName: 'Mira' });
  const unsupported = executeNpcLookupTool(context, 'get_actor_items', {
    ownerType: 'world',
    npcName: 'Mira'
  });
  const protagonist = executeNpcLookupTool(context, 'get_actor_items', {
    ownerType: ' protagonist '
  });

  assert.deepEqual(missing, {
    ok: false,
    error: 'ACTOR_OWNER_TYPE_INVALID',
    allowedOwnerTypes: ['npc', 'protagonist']
  });
  assert.deepEqual(unsupported, missing);
  assert.equal(protagonist.ok, true);
  assert.equal(protagonist.ownerType, 'protagonist');
  assert.equal(protagonist.ownerName, env.character.name);
});

test('NPC detail lookup reuses one aggregated roster snapshot', () => {
  const env = setupNpcContext();
  const queryCounts = {
    memoryAggregate: 0,
    behaviorAggregate: 0,
    registryList: 0
  };
  const database = new Proxy(env.db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => {
          const text = String(sql);
          if (text.includes('FROM npc_memories') && text.includes('GROUP BY npc_name')) {
            queryCounts.memoryAggregate += 1;
          }
          if (text.includes('FROM npc_behaviors') && text.includes('GROUP BY npc_name')) {
            queryCounts.behaviorAggregate += 1;
          }
          if (text.includes('SELECT * FROM npc_registry')) {
            queryCounts.registryList += 1;
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  const profile = executeNpcLookupTool({
    db: database,
    userId: env.userId,
    conversationId: env.conversationId,
    mainCharacterName: env.character.name
  }, 'get_npc_profile', { npcName: 'Mira' });

  assert.equal(profile.ok, true);
  assert.equal(profile.npc.name, 'Mira Valen');
  assert.deepEqual(queryCounts, {
    memoryAggregate: 1,
    behaviorAggregate: 1,
    registryList: 1
  });
});

function setupNpcContext() {
  const db = createAppDatabase(':memory:');
  const userId = 'npc-context-tool-user';
  insertUser(db, userId);
  const character = createCharacter(db, userId, { name: 'Hero' });
  const conversationId = 'npc-context-tool-conversation';
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, userId, character.id, 'NPC context tools', timestamp, timestamp);

  upsertConversationNpc(db, userId, conversationId, {
    npcName: 'Mira Valen',
    aliases: ['Mira', 'Little Mi'],
    currentLocation: 'North watchtower',
    relationship: 'Trusts Hero'
  });
  addNpcMemory(db, userId, conversationId, 'Mira Valen', {
    memoryType: 'knowledge',
    content: 'Old bridge secret'
  });
  addNpcBehavior(db, userId, conversationId, 'Mira Valen', {
    behaviorType: 'reaction',
    triggerCondition: 'When raiders approach',
    action: 'Rings the warning bell',
    priority: 80,
    enabled: true
  });
  upsertSceneItem(db, userId, conversationId, {
    itemCode: 'itm_mira_key',
    ownerType: 'npc',
    ownerName: 'Mira Valen',
    name: 'Silver key',
    itemKind: 'item',
    iconKey: 'item.key'
  });
  upsertSceneItem(db, userId, conversationId, {
    itemCode: 'itm_keeper_key',
    ownerType: 'npc',
    ownerName: 'Item Keeper',
    name: 'Storehouse key',
    itemKind: 'item',
    iconKey: 'item.key'
  });

  return { db, userId, character, conversationId };
}
