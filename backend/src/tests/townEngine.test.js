import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-town-engine';

const { createAppDatabase } = await import('../db.js');
const { runDueTownSimulationSteps, runTownSimulationStep } = await import('../modules/townEngine.js');
const {
  createTown,
  createTownResident,
  getTownSchedule,
  listTownEvents,
  listTownResidents,
  recordTownEvent,
  retrieveTownMemories,
  updateTownClock
} = await import('../modules/townSimulation.js');
const { nowIso } = await import('../security.js');

function setupEngineTown() {
  const database = createAppDatabase(':memory:');
  const userId = 'town-engine-user';
  database.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, userId, 'hash', nowIso());
  const town = createTown(database, userId, {
    name: '引擎测试镇',
    simulationStatus: 'running',
    currentDay: 1,
    minuteOfDay: 480,
    settings: { tickMinutes: 15, realSecondsPerTick: 2 }
  });
  const residents = [
    createTownResident(database, userId, town.id, {
      name: '沈月', role: '茶摊掌柜', reflectionThreshold: 10,
      profile: { goal: '调查账本', activities: ['开茶摊', '打听消息'], dialogue: ['你听说账本了吗？'] }
    }),
    createTownResident(database, userId, town.id, {
      name: '周巡夜', role: '巡夜人', reflectionThreshold: 10,
      profile: { goal: '维护夜市安全', activities: ['沿街巡查', '检查灯火'], dialogue: ['今夜要多留心。'] }
    }),
    createTownResident(database, userId, town.id, {
      name: '林小夏', role: '异乡旅人', reflectionThreshold: 10,
      profile: { goal: '寻找落脚处', activities: ['记录见闻', '向人问路'], dialogue: ['这里和我的家乡完全不同。'] }
    })
  ];
  return { database, userId, town, residents };
}

test('town engine advances shared state and turns a god event into resident reactions', () => {
  const { database, userId, town, residents } = setupEngineTown();
  const intervention = recordTownEvent(database, userId, town.id, {
    eventType: 'world.intervention',
    source: 'player',
    title: '钟楼敲响十三次',
    payload: { uiType: 'intervention' },
    occurredTick: 480
  });

  const first = runTownSimulationStep(database, userId, town.id);
  assert.equal(first.advanced, true);
  assert.equal(first.snapshot.town.minuteOfDay, 495);
  assert.equal(first.generated.kind, 'intervention');
  assert.match(first.generated.event.detail, /钟楼敲响十三次/);
  assert.ok(database.prepare('SELECT handled_at FROM town_events WHERE id = ?').get(intervention.id).handled_at);

  const updatedResidents = listTownResidents(database, userId, town.id);
  assert.ok(updatedResidents.every((resident) => resident.state.currentActivity));
  assert.ok(getTownSchedule(database, userId, town.id, residents[0].id, 1));
  const reactionMemory = retrieveTownMemories(database, userId, town.id, first.generated.residentIds[0], '钟楼', {
    limit: 5,
    trackAccess: false
  });
  assert.ok(reactionMemory.some((memory) => memory.content.includes('钟楼敲响十三次')));

  runTownSimulationStep(database, userId, town.id);
  runTownSimulationStep(database, userId, town.id);
  const fourth = runTownSimulationStep(database, userId, town.id);
  assert.equal(fourth.generated.kind, 'social');
  const types = new Set(listTownEvents(database, userId, town.id, { limit: 30 }).map((event) => event.eventType));
  assert.ok(types.has('resident.intervention.reaction'));
  assert.ok(types.has('resident.social'));
  assert.ok(database.prepare('SELECT COUNT(*) AS count FROM town_reflections WHERE town_id = ?').get(town.id).count > 0);
  database.close();
});

test('due-step runner catches up running towns and respects pause state', () => {
  const { database, userId, town } = setupEngineTown();
  const checkpoint = Date.parse('2026-07-22T00:00:00.000Z');
  database.prepare('UPDATE town_worlds SET engine_checkpoint_at = ? WHERE id = ?')
    .run(new Date(checkpoint).toISOString(), town.id);

  const results = runDueTownSimulationSteps(database, { nowMs: checkpoint + 4500 });
  assert.equal(results.length, 1);
  assert.equal(results[0].steps, 2);
  assert.equal(results[0].latest.snapshot.town.minuteOfDay, 510);

  updateTownClock(database, userId, town.id, { simulationStatus: 'paused' });
  assert.deepEqual(runDueTownSimulationSteps(database, { nowMs: checkpoint + 20000 }), []);
  database.close();
});
