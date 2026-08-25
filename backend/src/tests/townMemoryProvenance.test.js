import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-town-memory-provenance';

const { createAppDatabase } = await import('../db.js');
const {
  createTown,
  createTownResident,
  recordTownMemory,
  retrieveTownMemories
} = await import('../modules/townSimulation.js');
const { nowIso } = await import('../security.js');

function setupTestEnv() {
  const database = createAppDatabase(':memory:');
  const userId = 'provenance-user';
  const timestamp = nowIso();
  database.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, 'provenance-user', 'hash', timestamp);
  const town = createTown(database, userId, {
    name: '溯源测试镇',
    currentDay: 1,
    minuteOfDay: 480
  });
  const resident = createTownResident(database, userId, town.id, {
    name: '测试居民',
    role: '观察者'
  });
  return { database, userId, town, resident };
}

test('engine memories are tagged with engine-ambient sourceKind', () => {
  const { database, userId, town, resident } = setupTestEnv();
  const memory = recordTownMemory(database, userId, town.id, resident.id, {
    content: '这是一条模拟引擎生成的记忆',
    importance: 3,
    sourceKind: 'engine-ambient',
    occurredTick: 480
  });
  assert.equal(memory.sourceKind, 'engine-ambient');
  const row = database.prepare('SELECT source_kind FROM town_memories WHERE id = ?').get(memory.id);
  assert.equal(row.source_kind, 'engine-ambient');
});

test('excludeSourceKinds filters ambient memories from retrieval candidates', () => {
  const { database, userId, town, resident } = setupTestEnv();
  for (let i = 0; i < 50; i += 1) {
    recordTownMemory(database, userId, town.id, resident.id, {
      content: `引擎噪声 ${i}`,
      importance: 3,
      sourceKind: 'engine-ambient',
      occurredTick: 480 + i
    });
  }
  const important = recordTownMemory(database, userId, town.id, resident.id, {
    content: '这是一条重要的 AI 记忆',
    importance: 9,
    sourceKind: 'ai-town-engine',
    occurredTick: 430
  });
  const unfiltered = retrieveTownMemories(database, userId, town.id, resident.id, '', {
    limit: 5
  });
  assert.ok(unfiltered.some((m) => m.sourceKind === 'engine-ambient'));
  const filtered = retrieveTownMemories(database, userId, town.id, resident.id, '', {
    limit: 5,
    excludeSourceKinds: ['engine-ambient']
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, important.id);
  assert.equal(filtered[0].importance, 9);
});

test('minImportance two-stage retrieval surfaces high-value old memories', () => {
  const { database, userId, town, resident } = setupTestEnv();
  const veryImportant = recordTownMemory(database, userId, town.id, resident.id, {
    content: '关键决策记忆',
    importance: 9,
    sourceKind: 'ai-town-engine',
    occurredTick: 100
  });
  for (let i = 0; i < 120; i += 1) {
    recordTownMemory(database, userId, town.id, resident.id, {
      content: `近期低重要度记忆 ${i}`,
      importance: 2,
      sourceKind: 'engine-ambient',
      occurredTick: 500 + i
    });
  }
  const withoutFloor = retrieveTownMemories(database, userId, town.id, resident.id, '', {
    limit: 10,
    candidateLimit: 100
  });
  assert.ok(!withoutFloor.some((m) => m.id === veryImportant.id));
  const withFloor = retrieveTownMemories(database, userId, town.id, resident.id, '', {
    limit: 10,
    candidateLimit: 100,
    minImportance: 7
  });
  assert.ok(withFloor.some((m) => m.id === veryImportant.id));
  const highValue = withFloor.find((m) => m.id === veryImportant.id);
  assert.equal(highValue.importance, 9);
});
