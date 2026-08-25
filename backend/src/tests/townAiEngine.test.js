import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-town-ai-engine';

const { createAppDatabase } = await import('../db.js');
const {
  applyTownTurnPlan,
  buildTownTurnContext
} = await import('../modules/townAiEngine.js');
const {
  createTown,
  createTownResident,
  getTown,
  listTownEvents,
  listTownResidents,
  recordTownEvent,
  recordTownMemory,
  saveTownSchedule,
  updateTownClock
} = await import('../modules/townSimulation.js');
const { insertUser } = await import('./routeTestUtils.js');

test('town AI context includes world rules, current schedules, recent events and retrieved memories', () => {
  const database = createAppDatabase(':memory:');
  const fixture = createTestWorld(database, 'town-ai-context');
  const context = buildTownTurnContext(database, fixture.userId, fixture.town.id);

  assert.equal(context.world.creationPrompt, '创建一座陨石雨后的山谷聚落。');
  assert.deepEqual(context.world.rules, ['居民只依据亲历或听闻的信息行动。']);
  assert.equal(context.time.simulationStatus, 'paused');
  assert.equal(context.locations[1].id, 'location-garden');
  assert.equal(context.residents[0].goal.length > 0, true);
  assert.equal(context.residents[0].currentSchedule.activity, '检查桥面裂缝');
  assert.ok(context.residents[0].memories.some((memory) => memory.content.includes('桥墩')));
  assert.ok(context.recentEvents.some((event) => event.title === '夜空再次亮起'));
  assert.equal(context.pendingIntervention, null);

  database.close();
});

test('paused town applies a validated AI turn using map building coordinates and records its timeline and memories', () => {
  const database = createAppDatabase(':memory:');
  const fixture = createTestWorld(database, 'town-ai-apply');
  const intervention = recordTownEvent(database, fixture.userId, fixture.town.id, {
    eventType: 'world.intervention',
    source: 'player',
    title: '桥下传来三次钟声',
    detail: '桥下没有钟，却连续响了三次。',
    payload: { uiType: 'intervention' },
    occurredTick: 600
  });
  const context = buildTownTurnContext(database, fixture.userId, fixture.town.id);
  const plan = createTurnPlan(fixture, intervention.id);
  const result = applyTownTurnPlan(database, fixture.userId, fixture.town.id, plan, {
    expectedTick: context.version.tick
  });

  assert.equal(result.advanced, true);
  assert.equal(result.mode, 'ai');
  assert.equal(result.tickMinutes, 15);
  assert.equal(result.snapshot.town.currentDay, 1);
  assert.equal(result.snapshot.town.minuteOfDay, 615);

  const keeper = result.snapshot.residents.find((resident) => resident.id === fixture.keeper.id);
  const herbalist = result.snapshot.residents.find((resident) => resident.id === fixture.herbalist.id);
  assert.equal(keeper.currentLocation, '鹿鸣药圃');
  assert.equal(keeper.state.mapX, 830);
  assert.equal(keeper.state.mapY, 380);
  assert.equal(keeper.state.currentActivity, '带鹿鸣检查发光药草');
  assert.equal(herbalist.currentLocation, '星痕石桥');
  assert.equal(herbalist.state.mapX, 330);
  assert.equal(herbalist.state.mapY, 240);

  const events = listTownEvents(database, fixture.userId, fixture.town.id, { limit: 200 });
  const aiEvent = events.find((event) => event.source === 'ai-town-engine');
  assert.equal(aiEvent.eventType, 'resident.intervention.reaction');
  assert.deepEqual(aiEvent.payload.participantIds, [fixture.keeper.id, fixture.herbalist.id]);
  assert.equal(aiEvent.payload.respondsToEventId, intervention.id);
  assert.ok(events.find((event) => event.id === intervention.id).handledAt);

  const aiMemories = database.prepare(
    "SELECT resident_id, content, source_event_id FROM town_memories WHERE source_kind = 'ai-town-engine' ORDER BY rowid ASC"
  ).all();
  assert.equal(aiMemories.length, 2);
  assert.ok(aiMemories.every((memory) => memory.source_event_id === aiEvent.id));

  database.close();
});

test('town AI turn rejects running worlds, stale ticks and changed pending interventions', () => {
  const runningDatabase = createAppDatabase(':memory:');
  const runningFixture = createTestWorld(runningDatabase, 'town-ai-running');
  updateTownClock(runningDatabase, runningFixture.userId, runningFixture.town.id, { simulationStatus: 'running' });
  assert.throws(
    () => applyTownTurnPlan(
      runningDatabase,
      runningFixture.userId,
      runningFixture.town.id,
      createTurnPlan(runningFixture),
      { expectedTick: 600 }
    ),
    /请先暂停世界/
  );
  runningDatabase.close();

  const staleDatabase = createAppDatabase(':memory:');
  const staleFixture = createTestWorld(staleDatabase, 'town-ai-stale');
  const staleContext = buildTownTurnContext(staleDatabase, staleFixture.userId, staleFixture.town.id);
  updateTownClock(staleDatabase, staleFixture.userId, staleFixture.town.id, {
    simulationStatus: 'paused',
    minuteOfDay: 615
  });
  assert.throws(
    () => applyTownTurnPlan(
      staleDatabase,
      staleFixture.userId,
      staleFixture.town.id,
      createTurnPlan(staleFixture),
      { expectedTick: staleContext.version.tick }
    ),
    /世界状态已发生变化/
  );
  staleDatabase.close();

  const eventDatabase = createAppDatabase(':memory:');
  const eventFixture = createTestWorld(eventDatabase, 'town-ai-pending');
  const eventContext = buildTownTurnContext(eventDatabase, eventFixture.userId, eventFixture.town.id);
  recordTownEvent(eventDatabase, eventFixture.userId, eventFixture.town.id, {
    eventType: 'world.intervention',
    source: 'player',
    title: '请求生成之后出现的新事件',
    detail: '这条事件必须进入下一次模型上下文。',
    occurredTick: 600
  });
  assert.throws(
    () => applyTownTurnPlan(
      eventDatabase,
      eventFixture.userId,
      eventFixture.town.id,
      createTurnPlan(eventFixture),
      { expectedTick: eventContext.version.tick }
    ),
    /待处理世界事件已发生变化/
  );
  eventDatabase.close();
});

test('town AI turn rolls back resident, event and clock changes when persistence fails', () => {
  const database = createAppDatabase(':memory:');
  const fixture = createTestWorld(database, 'town-ai-rollback');
  const context = buildTownTurnContext(database, fixture.userId, fixture.town.id);
  database.exec(`
    CREATE TRIGGER fail_ai_turn_memory
    BEFORE INSERT ON town_memories
    WHEN NEW.source_kind = 'ai-town-engine'
    BEGIN
      SELECT RAISE(ABORT, 'forced ai memory failure');
    END
  `);

  assert.throws(
    () => applyTownTurnPlan(database, fixture.userId, fixture.town.id, createTurnPlan(fixture), {
      expectedTick: context.version.tick
    }),
    /forced ai memory failure/
  );

  const town = getTown(database, fixture.userId, fixture.town.id);
  const residents = listTownResidents(database, fixture.userId, fixture.town.id);
  const events = listTownEvents(database, fixture.userId, fixture.town.id, { limit: 200 });
  assert.equal(town.minuteOfDay, 600);
  assert.equal(residents.find((resident) => resident.id === fixture.keeper.id).state.currentActivity, '检查桥面裂缝');
  assert.equal(events.some((event) => event.source === 'ai-town-engine'), false);

  database.close();
});

function createTestWorld(database, suffix) {
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
      tickMinutes: 15,
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
  const keeper = createTownResident(database, userId, town.id, {
    name: '石衡',
    role: '守桥人',
    currentLocation: '星痕石桥',
    profile: {
      summary: '熟悉石桥每一次异响。',
      goal: '阻止未知存在越过石桥',
      activities: ['检查桥面裂缝', '倾听桥下回声']
    },
    state: {
      mood: '警觉',
      currentActivity: '检查桥面裂缝',
      currentIntention: '确认桥墩异响来源',
      mapX: 330,
      mapY: 240
    }
  });
  const herbalist = createTownResident(database, userId, town.id, {
    name: '鹿鸣',
    role: '药师',
    currentLocation: '鹿鸣药圃',
    profile: {
      summary: '研究陨石雨后的变异药草。',
      goal: '找到能稳定梦境的星尘草',
      activities: ['照料发光药草', '记录伤者梦境']
    },
    state: {
      mood: '专注',
      currentActivity: '照料发光药草',
      currentIntention: '记录星尘草的发光规律',
      mapX: 830,
      mapY: 380
    }
  });
  saveTownSchedule(database, userId, town.id, keeper.id, {
    day: 1,
    goal: keeper.profile.goal,
    items: [{
      startMinute: 540,
      endMinute: 720,
      activity: '检查桥面裂缝',
      location: '星痕石桥',
      intention: '确认桥墩异响来源'
    }]
  });
  saveTownSchedule(database, userId, town.id, herbalist.id, {
    day: 1,
    goal: herbalist.profile.goal,
    items: [{
      startMinute: 540,
      endMinute: 720,
      activity: '照料发光药草',
      location: '鹿鸣药圃',
      intention: '记录星尘草的发光规律'
    }]
  });
  recordTownMemory(database, userId, town.id, keeper.id, {
    memoryType: 'event',
    content: '昨夜桥墩内部连续响了三次。',
    importance: 8,
    occurredTick: 540
  });
  recordTownMemory(database, userId, town.id, herbalist.id, {
    memoryType: 'observation',
    content: '星尘草在桥墩异响后转向石桥。',
    importance: 7,
    occurredTick: 570
  });
  recordTownEvent(database, userId, town.id, {
    eventType: 'world.opening',
    source: 'ai-world-generation',
    title: '夜空再次亮起',
    detail: '石桥下传来低沉回声。',
    payload: { uiType: 'opening' },
    occurredTick: 580
  });
  return { userId, town, keeper, herbalist };
}

function createTurnPlan(fixture, respondsToEventId = '') {
  return {
    event: {
      eventType: respondsToEventId ? 'resident.intervention.reaction' : 'resident.social',
      uiType: respondsToEventId ? 'clue' : 'dialogue',
      title: '石桥异响让两人交换线索',
      detail: '石衡请鹿鸣查看发光药草，鹿鸣则带石衡回到石桥比较药草偏转与桥墩异响。',
      participantIds: [fixture.keeper.id, fixture.herbalist.id],
      respondsToEventId
    },
    actions: [
      {
        residentId: fixture.keeper.id,
        locationId: 'location-garden',
        activity: '带鹿鸣检查发光药草',
        intention: '确认药草是否回应桥下异响',
        mood: '戒备',
        memory: '我和鹿鸣比较了星尘草的光向与桥下钟声。',
        importance: 8
      },
      {
        residentId: fixture.herbalist.id,
        locationId: 'location-bridge',
        activity: '在石桥旁比较药草光向',
        intention: '验证星尘草与桥墩异响的关联',
        mood: '专注',
        memory: '石衡带来的钟声线索与药草偏转完全吻合。',
        importance: 8
      }
    ]
  };
}
