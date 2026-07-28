import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-town-cognition-engine';

const { createAppDatabase } = await import('../db.js');
const {
  applyTownResidentCognitionPlan,
  buildTownResidentCognitionContext,
  getTownResidentCognition
} = await import('../modules/townCognitionEngine.js');
const {
  createTown,
  createTownResident,
  evaluateTownReflectionNeed,
  getTownSchedule,
  listTownEvents,
  listTownReflections,
  listTownResidents,
  listTownUnreflectedMemories,
  recordTownEvent,
  recordTownMemory,
  saveTownSchedule,
  updateTownClock
} = await import('../modules/townSimulation.js');
const { insertUser } = await import('./routeTestUtils.js');

test('town cognition context includes threshold evidence, retrieved memories, history and current schedule', () => {
  const database = createAppDatabase(':memory:');
  const fixture = createCognitionWorld(database, 'town-cognition-context');
  const context = buildTownResidentCognitionContext(database, fixture.userId, fixture.town.id, fixture.resident.id);

  assert.equal(context.world.creationPrompt, '创建一座陨石雨后的山谷聚落。');
  assert.equal(context.time.targetDay, 1);
  assert.equal(context.resident.goal, '确认桥下异响与星尘草的关系');
  assert.equal(context.reflectionStatus.shouldReflect, true);
  assert.deepEqual(new Set(context.unreflectedMemories.map((memory) => memory.id)), new Set(fixture.memoryIds));
  assert.ok(context.retrievedMemories.some((memory) => memory.content.includes('桥墩')));
  assert.equal(context.existingSchedule.items[0].activity, '巡查石桥');
  assert.ok(context.recentEvents.some((event) => event.title === '星尘草朝石桥发光'));

  database.close();
});

test('paused town atomically applies AI reflection, schedule, resident state and timeline', () => {
  const database = createAppDatabase(':memory:');
  const fixture = createCognitionWorld(database, 'town-cognition-apply');
  const context = buildTownResidentCognitionContext(database, fixture.userId, fixture.town.id, fixture.resident.id);
  const result = applyTownResidentCognitionPlan(
    database,
    fixture.userId,
    fixture.town.id,
    fixture.resident.id,
    createCognitionPlan(fixture.memoryIds),
    { expectedVersion: context.version }
  );

  assert.equal(result.updated, true);
  assert.equal(result.mode, 'ai-cognition');
  assert.ok(result.generated.reflection.content.includes('同一条线索'));
  assert.equal(result.generated.schedule.goal, '确认桥墩异响是否会引导星尘草发光');
  assert.equal(result.cognition.reflections.length, 1);
  assert.equal(result.cognition.schedule.items.length, 2);

  const resident = result.snapshot.residents.find((item) => item.id === fixture.resident.id);
  assert.equal(resident.currentLocation, '星痕石桥');
  assert.equal(resident.state.currentActivity, '检查桥墩裂缝与回声');
  assert.equal(resident.state.mapX, 330);
  assert.equal(resident.state.mapY, 240);

  const events = listTownEvents(database, fixture.userId, fixture.town.id, { limit: 200 });
  assert.ok(events.some((event) => event.source === 'ai-town-cognition'));
  assert.ok(events.some((event) => event.eventType === 'resident.reflection'));
  assert.equal(listTownReflections(database, fixture.userId, fixture.town.id, fixture.resident.id).length, 1);
  assert.equal(evaluateTownReflectionNeed(database, fixture.userId, fixture.town.id, fixture.resident.id).importanceTotal, 5);

  database.close();
});

test('town cognition rejects running or stale state before applying model output', () => {
  const runningDatabase = createAppDatabase(':memory:');
  const runningFixture = createCognitionWorld(runningDatabase, 'town-cognition-running');
  const runningContext = buildTownResidentCognitionContext(
    runningDatabase,
    runningFixture.userId,
    runningFixture.town.id,
    runningFixture.resident.id
  );
  updateTownClock(runningDatabase, runningFixture.userId, runningFixture.town.id, { simulationStatus: 'running' });
  assert.throws(
    () => applyTownResidentCognitionPlan(
      runningDatabase,
      runningFixture.userId,
      runningFixture.town.id,
      runningFixture.resident.id,
      createCognitionPlan(runningFixture.memoryIds),
      { expectedVersion: runningContext.version }
    ),
    /请先暂停世界/
  );
  runningDatabase.close();

  const staleDatabase = createAppDatabase(':memory:');
  const staleFixture = createCognitionWorld(staleDatabase, 'town-cognition-stale');
  const staleContext = buildTownResidentCognitionContext(
    staleDatabase,
    staleFixture.userId,
    staleFixture.town.id,
    staleFixture.resident.id
  );
  recordTownMemory(staleDatabase, staleFixture.userId, staleFixture.town.id, staleFixture.resident.id, {
    content: '模型生成期间又出现了一条新记忆。',
    importance: 4
  });
  assert.throws(
    () => applyTownResidentCognitionPlan(
      staleDatabase,
      staleFixture.userId,
      staleFixture.town.id,
      staleFixture.resident.id,
      createCognitionPlan(staleFixture.memoryIds),
      { expectedVersion: staleContext.version }
    ),
    /居民认知状态已发生变化/
  );
  staleDatabase.close();
});

test('town cognition rolls back reflection and schedule when any persistence step fails', () => {
  const database = createAppDatabase(':memory:');
  const fixture = createCognitionWorld(database, 'town-cognition-rollback');
  const context = buildTownResidentCognitionContext(database, fixture.userId, fixture.town.id, fixture.resident.id);
  database.exec(`
    CREATE TRIGGER fail_ai_cognition_schedule
    BEFORE INSERT ON town_schedule_items
    WHEN NEW.activity = '拜访鹿鸣并比较药草光向'
    BEGIN
      SELECT RAISE(ABORT, 'forced cognition schedule failure');
    END
  `);

  assert.throws(
    () => applyTownResidentCognitionPlan(
      database,
      fixture.userId,
      fixture.town.id,
      fixture.resident.id,
      createCognitionPlan(fixture.memoryIds),
      { expectedVersion: context.version }
    ),
    /forced cognition schedule failure/
  );

  assert.equal(listTownReflections(database, fixture.userId, fixture.town.id, fixture.resident.id).length, 0);
  assert.equal(getTownSchedule(database, fixture.userId, fixture.town.id, fixture.resident.id, 1).goal, '守住石桥');
  assert.equal(listTownUnreflectedMemories(database, fixture.userId, fixture.town.id, fixture.resident.id).length, 2);
  assert.equal(
    listTownEvents(database, fixture.userId, fixture.town.id, { limit: 200 })
      .some((event) => event.source === 'ai-town-cognition'),
    false
  );
  assert.equal(getTownResidentCognition(database, fixture.userId, fixture.town.id, fixture.resident.id).reflections.length, 0);

  database.close();
});

function createCognitionWorld(database, suffix) {
  const userId = `user-${suffix}`;
  insertUser(database, userId);
  const town = createTown(database, userId, {
    name: '星落谷',
    description: '陨石雨后的山谷聚落。',
    creationPrompt: '创建一座陨石雨后的山谷聚落。',
    simulationStatus: 'paused',
    currentDay: 1,
    minuteOfDay: 600,
    settings: {
      worldRules: ['居民只依据亲历或听闻的信息行动。'],
      environment: { biome: 'fantasy', atmosphere: '夜色里漂浮着星尘。' }
    },
    mapConfig: {
      renderMode: 'procedural-v1',
      width: 1600,
      height: 900,
      locations: [
        { id: 'location-bridge', name: '星痕石桥', kind: 'bridge', description: '横跨河谷的旧石桥。', x: 300, y: 220 },
        { id: 'location-garden', name: '鹿鸣药圃', kind: 'garden', description: '种植星尘草的药圃。', x: 800, y: 360 }
      ],
      buildings: [
        { id: 'building-bridge', locationId: 'location-bridge', x: 360, y: 260, width: 48, height: 32 },
        { id: 'building-garden', locationId: 'location-garden', x: 860, y: 400, width: 44, height: 30 }
      ]
    }
  });
  const resident = createTownResident(database, userId, town.id, {
    name: '石衡',
    role: '守桥人',
    currentLocation: '星痕石桥',
    reflectionThreshold: 15,
    profile: {
      summary: '熟悉石桥每一次异响。',
      goal: '确认桥下异响与星尘草的关系',
      activities: ['巡查石桥', '拜访药圃']
    },
    state: {
      mood: '警觉',
      currentActivity: '巡查石桥',
      currentIntention: '确认桥下异响来源',
      mapX: 330,
      mapY: 240
    }
  });
  saveTownSchedule(database, userId, town.id, resident.id, {
    day: 1,
    goal: '守住石桥',
    items: [
      { startMinute: 480, endMinute: 720, activity: '巡查石桥', location: '星痕石桥', intention: '确认桥面安全' },
      { startMinute: 720, endMinute: 900, activity: '记录异响', location: '星痕石桥', intention: '整理回声规律' }
    ]
  });
  const first = recordTownMemory(database, userId, town.id, resident.id, {
    memoryType: 'event',
    content: '昨夜桥墩内部连续响了三次。',
    importance: 8,
    occurredTick: 540
  });
  const second = recordTownMemory(database, userId, town.id, resident.id, {
    memoryType: 'relationship',
    content: '鹿鸣说星尘草在异响后朝石桥发光。',
    importance: 8,
    occurredTick: 570
  });
  recordTownEvent(database, userId, town.id, {
    eventType: 'resident.discovery',
    source: 'town-engine',
    title: '星尘草朝石桥发光',
    detail: '鹿鸣把药草偏转的发现告诉了石衡。',
    payload: { uiType: 'clue', participantIds: [resident.id] },
    occurredTick: 580
  });
  return { userId, town, resident, memoryIds: [first.id, second.id] };
}

function createCognitionPlan(memoryIds) {
  return {
    reflection: {
      create: true,
      content: '桥墩异响和星尘草偏转可能是同一条线索，我应当按时间与地点逐一核对。',
      evidenceMemoryIds: memoryIds,
      importance: 8
    },
    schedule: {
      goal: '确认桥墩异响是否会引导星尘草发光',
      items: [
        {
          startMinute: 480,
          endMinute: 660,
          activity: '检查桥墩裂缝与回声',
          locationId: 'location-bridge',
          intention: '记录异响出现的准确方位'
        },
        {
          startMinute: 660,
          endMinute: 840,
          activity: '拜访鹿鸣并比较药草光向',
          locationId: 'location-garden',
          intention: '验证药草发光与桥下回声的关联'
        }
      ]
    }
  };
}
