import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-cast-memory-decay';

const { createAppDatabase } = await import('../db.js');
const {
  createCastMember,
  createCastMemory,
  ensureConversationProtagonist,
  updateCastMemoryEntry,
  updateCastMemberProfile,
} = await import('../services/cast/castCommandService.js');
const { getCastMemoryEntry } = await import('../services/cast/castQueryService.js');
const {
  calculateDecayUpdate,
  decayCastMemories,
} = await import('../services/cast/castMemoryLifecycle.js');
const { newId, nowIso } = await import('../security.js');

function setup() {
  const database = createAppDatabase(':memory:');
  const userId = `cast-decay-${newId()}`;
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, userId, 'hash', timestamp);
  database.prepare(
    'INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(characterId, userId, 'Hero', 'private', timestamp, timestamp);
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, characterId, 'Decay test', timestamp, timestamp);
  ensureConversationProtagonist(database, userId, conversationId);
  return { database, userId, conversationId };
}

function createMemory(env, overrides = {}) {
  const member = createCastMember(env.database, env.userId, env.conversationId, {
    canonicalName: `Keeper ${newId()}`,
  });
  const memory = createCastMemory(env.database, env.userId, env.conversationId, member.id, {
    content: `Memory ${newId()}`,
    importance: 1,
    decayRate: 0.1,
    ...overrides,
  });
  return { member, memory };
}

function setMemoryClock(database, memoryId, timestamp, lastReinforcedAt = null) {
  database.prepare(
    'UPDATE cast_memories SET created_at = ?, updated_at = ?, last_reinforced_at = ? WHERE id = ?'
  ).run(timestamp, timestamp, lastReinforcedAt, memoryId);
}

test('repeated decay at the same logical time is idempotent and later periods are incremental', () => {
  const env = setup();
  try {
    const { member, memory } = createMemory(env);
    setMemoryClock(env.database, memory.id, '2030-01-01T12:00:00.000Z');

    const first = decayCastMemories(env.database, env.userId, env.conversationId, {
      now: new Date('2030-01-03T18:00:00.000Z'),
    });
    assert.equal(first.updated, 1);
    let current = getCastMemoryEntry(env.database, env.userId, env.conversationId, member.id, memory.id);
    assert.equal(current.importance, 0.81);
    assert.equal(current.lastDecayedAt, '2030-01-03T12:00:00.000Z');
    assert.equal(current.lastReinforcedAt, '');

    const repeated = decayCastMemories(env.database, env.userId, env.conversationId, {
      now: new Date('2030-01-03T18:00:00.000Z'),
    });
    assert.equal(repeated.updated, 0);
    current = getCastMemoryEntry(env.database, env.userId, env.conversationId, member.id, memory.id);
    assert.equal(current.importance, 0.81);

    decayCastMemories(env.database, env.userId, env.conversationId, {
      now: new Date('2030-01-04T12:00:00.000Z'),
    });
    current = getCastMemoryEntry(env.database, env.userId, env.conversationId, member.id, memory.id);
    assert.equal(current.importance, 0.729);
  } finally {
    env.database.close();
  }
});

test('reinforcement resets the decay baseline without being counted as decay reinforcement', () => {
  const memory = {
    importance: 0.8,
    decayRate: 0.1,
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-03T00:00:00.000Z',
    lastReinforcedAt: '2030-01-05T06:00:00.000Z',
    lastDecayedAt: '',
    reinforcementCount: 2,
  };
  assert.equal(calculateDecayUpdate(memory, new Date('2030-01-06T05:59:59.999Z')), null);
  const update = calculateDecayUpdate(memory, new Date('2030-01-06T06:00:00.000Z'));
  assert.equal(update.importance, 0.72);
  assert.equal(update.lastDecayedAt, '2030-01-06T06:00:00.000Z');
  assert.equal(Object.hasOwn(update, 'reinforcementCount'), false);
});

test('reinforcement and manual importance changes reset the independent decay checkpoint', () => {
  const env = setup();
  try {
    const { member, memory } = createMemory(env, { importance: 0.4 });
    env.database.prepare(
      'UPDATE cast_memories SET last_decayed_at = ? WHERE id = ?'
    ).run('2020-01-01T00:00:00.000Z', memory.id);

    const reinforced = createCastMemory(env.database, env.userId, env.conversationId, member.id, {
      content: memory.content,
      importance: 0.8,
      decayRate: 0.1,
    });
    assert.equal(reinforced.reinforcementCount, 1);
    assert.equal(reinforced.lastDecayedAt, reinforced.lastReinforcedAt);
    assert.equal(reinforced.importance, 0.8);

    env.database.prepare(
      'UPDATE cast_memories SET last_decayed_at = ? WHERE id = ?'
    ).run('2020-01-01T00:00:00.000Z', memory.id);
    const edited = updateCastMemoryEntry(
      env.database,
      env.userId,
      env.conversationId,
      member.id,
      memory.id,
      { importance: 0.6, revision: reinforced.revision }
    );
    assert.equal(edited.importance, 0.6);
    assert.notEqual(edited.lastDecayedAt, '2020-01-01T00:00:00.000Z');
    assert.equal(Date.parse(edited.lastDecayedAt), Date.parse(edited.updatedAt));
  } finally {
    env.database.close();
  }
});

test('sealed members and already forgotten memories are not decayed', () => {
  const env = setup();
  try {
    const sealed = createMemory(env);
    setMemoryClock(env.database, sealed.memory.id, '2030-01-01T00:00:00.000Z');
    updateCastMemberProfile(env.database, env.userId, env.conversationId, sealed.member.id, {
      memorySealed: true,
      revision: sealed.member.revision,
    });
    const forgotten = createMemory(env, { forgottenAt: '2030-01-02T00:00:00.000Z' });
    setMemoryClock(env.database, forgotten.memory.id, '2030-01-01T00:00:00.000Z');

    const result = decayCastMemories(env.database, env.userId, env.conversationId, {
      now: new Date('2030-01-10T00:00:00.000Z'),
    });
    assert.equal(result.updated, 0);
    assert.equal(result.scanned, 1);
  } finally {
    env.database.close();
  }
});

test('partial days accumulate while backwards time is ignored', () => {
  const memory = {
    importance: 0.5,
    decayRate: 0.2,
    createdAt: '2030-01-02T12:00:00.000Z',
    updatedAt: '2030-01-02T12:00:00.000Z',
    lastReinforcedAt: '',
    lastDecayedAt: '',
  };
  assert.equal(calculateDecayUpdate(memory, new Date('2030-01-02T11:00:00.000Z')), null);
  assert.equal(calculateDecayUpdate(memory, new Date('2030-01-03T11:59:59.999Z')), null);
  const update = calculateDecayUpdate(memory, new Date('2030-01-04T00:00:00.000Z'));
  assert.equal(update.importance, 0.4);
  assert.equal(update.lastDecayedAt, '2030-01-03T12:00:00.000Z');
});

test('metadata edits do not move an existing decay checkpoint', () => {
  const update = calculateDecayUpdate({
    importance: 1,
    decayRate: 0.1,
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-20T00:00:00.000Z',
    lastReinforcedAt: '',
    lastDecayedAt: '2030-01-10T00:00:00.000Z',
  }, new Date('2030-01-12T00:00:00.000Z'));
  assert.equal(update.importance, 0.81);
  assert.equal(update.lastDecayedAt, '2030-01-12T00:00:00.000Z');
});
