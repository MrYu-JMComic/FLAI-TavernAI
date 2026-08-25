import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-town-deletion';

const { createAppDatabase } = await import('../db.js');
const {
  createTown,
  createTownResident,
  deleteTown,
  deleteTownResident,
  getTown,
  listTownResidents,
  recordTownEvent,
  recordTownMemory
} = await import('../modules/townSimulation.js');
const { nowIso } = await import('../security.js');

function setupTestEnv() {
  const database = createAppDatabase(':memory:');
  const userId = 'delete-user';
  const otherUserId = 'delete-other';
  const timestamp = nowIso();
  for (const id of [userId, otherUserId]) {
    database.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, id, 'hash', timestamp);
  }
  const town = createTown(database, userId, {
    name: '待删除小镇',
    simulationStatus: 'running'
  });
  const resident = createTownResident(database, userId, town.id, {
    name: '居民甲',
    role: '测试'
  });
  return { database, userId, otherUserId, town, resident };
}

test('deleting a town cascades to residents, events and memories', () => {
  const { database, userId, town, resident } = setupTestEnv();
  const event = recordTownEvent(database, userId, town.id, {
    residentId: resident.id,
    eventType: 'resident.action',
    title: '测试事件',
    detail: '测试细节',
    occurredTick: 480
  });
  recordTownMemory(database, userId, town.id, resident.id, {
    content: '一条记忆',
    importance: 5,
    sourceEventId: event.id,
    occurredTick: 480
  });

  const result = deleteTown(database, userId, town.id);
  assert.deepEqual(result, { id: town.id, deleted: true });
  assert.equal(getTown(database, userId, town.id), null);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS c FROM town_residents WHERE town_id = ?').get(town.id).c,
    0
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS c FROM town_events WHERE town_id = ?').get(town.id).c,
    0
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS c FROM town_memories WHERE town_id = ?').get(town.id).c,
    0
  );
});

test('deleting a running town leaves nothing for the engine to pick up', () => {
  const { database, userId, town } = setupTestEnv();
  assert.equal(getTown(database, userId, town.id).simulationStatus, 'running');
  deleteTown(database, userId, town.id);
  const running = database.prepare(
    "SELECT COUNT(*) AS c FROM town_worlds WHERE simulation_status = 'running' AND id = ?"
  ).get(town.id).c;
  assert.equal(running, 0);
});

test('town deletion is scoped to the owner', () => {
  const { database, userId, otherUserId, town } = setupTestEnv();
  assert.equal(deleteTown(database, otherUserId, town.id), null);
  assert.ok(getTown(database, userId, town.id));
});

test('resident deletion removes only that resident and is owner scoped', () => {
  const { database, userId, otherUserId, town, resident } = setupTestEnv();
  const second = createTownResident(database, userId, town.id, { name: '居民乙', role: '测试' });
  recordTownMemory(database, userId, town.id, resident.id, {
    content: '甲的记忆',
    importance: 5,
    occurredTick: 480
  });

  assert.equal(deleteTownResident(database, otherUserId, town.id, resident.id), null);
  assert.equal(listTownResidents(database, userId, town.id).length, 2);

  const result = deleteTownResident(database, userId, town.id, resident.id);
  assert.deepEqual(result, { id: resident.id, deleted: true });
  const remaining = listTownResidents(database, userId, town.id);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, second.id);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS c FROM town_memories WHERE resident_id = ?').get(resident.id).c,
    0
  );
  assert.ok(getTown(database, userId, town.id));
});

test('deleting a missing town or resident returns null', () => {
  const { database, userId, town } = setupTestEnv();
  assert.equal(deleteTown(database, userId, 'no-such-town'), null);
  assert.equal(deleteTownResident(database, userId, town.id, 'no-such-resident'), null);
});
