import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-town-simulation';

const { createAppDatabase } = await import('../db.js');
const {
  createTown,
  createTownReflection,
  createTownResident,
  evaluateTownReflectionNeed,
  getTownSchedule,
  listTownEvents,
  listTownResidents,
  recordTownEvent,
  recordTownMemory,
  retrieveTownMemories,
  saveTownSchedule,
  scoreTownMemory,
  updateTownClock
} = await import('../modules/townSimulation.js');
const { nowIso } = await import('../security.js');

function setupTestEnv() {
  const database = createAppDatabase(':memory:');
  const userId = 'town-user';
  const otherUserId = 'town-other';
  const timestamp = nowIso();
  database.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, 'town-user', 'hash', timestamp);
  database.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(otherUserId, 'town-other', 'hash', timestamp);
  const town = createTown(database, userId, {
    name: '汴京夜市',
    simulationStatus: 'running',
    currentDay: 3,
    minuteOfDay: 600,
    settings: { speed: 2 }
  });
  const resident = createTownResident(database, userId, town.id, {
    name: '沈月',
    role: '茶摊掌柜',
    currentLocation: '虹桥茶摊',
    reflectionThreshold: 12
  });
  return { database, userId, otherUserId, town, resident };
}

test('town persistence is independent from conversations and isolated by owner', () => {
  const { database, userId, otherUserId, town, resident } = setupTestEnv();
  assert.equal(town.name, '汴京夜市');
  assert.equal(town.settings.speed, 2);
  assert.equal(listTownResidents(database, userId, town.id)[0].id, resident.id);
  assert.equal(listTownResidents(database, otherUserId, town.id), null);
  assert.equal(createTownResident(database, otherUserId, town.id, { name: '越权居民' }), null);

  const updated = updateTownClock(database, userId, town.id, {
    currentDay: 4,
    minuteOfDay: 30,
    simulationStatus: 'paused'
  });
  assert.equal(updated.currentDay, 4);
  assert.equal(updated.minuteOfDay, 30);
  assert.equal(updated.simulationStatus, 'paused');
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'town_%'").get().count,
    7
  );
  database.close();
});

test('town memory recall combines recency, importance and query relevance', () => {
  const { database, userId, town, resident } = setupTestEnv();
  const marketEvent = recordTownEvent(database, userId, town.id, {
    residentId: resident.id,
    eventType: 'resident.observed',
    title: '灯笼摊争执',
    occurredTick: 3400
  });
  const relevant = recordTownMemory(database, userId, town.id, resident.id, {
    content: '沈月在灯笼摊听见商贩争论失踪的账本。',
    importance: 7,
    sourceEventId: marketEvent.id,
    occurredTick: 3400
  });
  const important = recordTownMemory(database, userId, town.id, resident.id, {
    content: '城门昨夜提前关闭。',
    importance: 10,
    occurredTick: 3300
  });
  recordTownMemory(database, userId, town.id, resident.id, {
    content: '午后整理了茶杯。',
    importance: 2,
    occurredTick: 3450
  });

  const recalled = retrieveTownMemories(database, userId, town.id, resident.id, '灯笼摊的账本', {
    referenceTick: 3500,
    limit: 2
  });
  assert.equal(recalled[0].id, relevant.id);
  assert.ok(recalled[0].scoreParts.relevance > recalled[1].scoreParts.relevance);
  assert.ok(recalled.some((memory) => memory.id === important.id));
  const accessCount = database.prepare('SELECT access_count FROM town_memories WHERE id = ?').get(relevant.id).access_count;
  assert.equal(accessCount, 1);

  const directScore = scoreTownMemory(relevant, '账本', { referenceTick: 3500 });
  assert.ok(directScore.scoreParts.recency > 0);
  assert.ok(directScore.scoreParts.importance === 0.7);
  assert.ok(directScore.scoreParts.relevance > 0);
  database.close();
});

test('reflection threshold consumes evidence memories and resets the pending queue', () => {
  const { database, userId, town, resident } = setupTestEnv();
  const first = recordTownMemory(database, userId, town.id, resident.id, {
    content: '常客连续三日没有出现。',
    importance: 7
  });
  const second = recordTownMemory(database, userId, town.id, resident.id, {
    content: '有人询问常客的去向。',
    importance: 6
  });
  const before = evaluateTownReflectionNeed(database, userId, town.id, resident.id);
  assert.equal(before.shouldReflect, true);
  assert.equal(before.importanceTotal, 13);

  const reflection = createTownReflection(database, userId, town.id, resident.id, {
    content: '常客的失踪可能不是偶然，我应当向巡夜人打听。',
    memoryIds: [first.id, second.id],
    importance: 8
  });
  assert.deepEqual(reflection.evidenceMemoryIds, [first.id, second.id]);
  const after = evaluateTownReflectionNeed(database, userId, town.id, resident.id);
  assert.equal(after.shouldReflect, false);
  assert.equal(after.memoryCount, 0);
  const recalled = retrieveTownMemories(database, userId, town.id, resident.id, '巡夜人 常客', {
    limit: 1,
    trackAccess: false
  });
  assert.equal(recalled[0].memoryType, 'reflection');
  const reflectionEvent = listTownEvents(database, userId, town.id).find((event) => event.eventType === 'resident.reflection');
  assert.equal(reflectionEvent.residentId, resident.id);
  assert.equal(reflectionEvent.payload.uiType, 'reflection');
  database.close();
});

test('daily schedules are ordered, replaceable and reject overlapping activities', () => {
  const { database, userId, town, resident } = setupTestEnv();
  const schedule = saveTownSchedule(database, userId, town.id, resident.id, {
    day: 3,
    goal: '维持茶摊生意并打听账本消息',
    items: [
      { startMinute: 720, endMinute: 780, activity: '去灯笼摊打听', location: '灯市' },
      { startMinute: 480, endMinute: 720, activity: '开茶摊', location: '虹桥' }
    ]
  });
  assert.deepEqual(schedule.items.map((item) => item.activity), ['开茶摊', '去灯笼摊打听']);

  const replacement = saveTownSchedule(database, userId, town.id, resident.id, {
    day: 3,
    goal: '雨天改在室内整理线索',
    items: [{ startMinute: 540, endMinute: 660, activity: '整理账册', location: '茶摊后屋' }]
  });
  assert.equal(replacement.id, schedule.id);
  assert.equal(getTownSchedule(database, userId, town.id, resident.id, 3).items.length, 1);
  assert.throws(() => saveTownSchedule(database, userId, town.id, resident.id, {
    day: 4,
    items: [
      { startMinute: 480, endMinute: 600, activity: '准备茶水' },
      { startMinute: 590, endMinute: 650, activity: '接待客人' }
    ]
  }), /不能互相重叠/);
  database.close();
});
