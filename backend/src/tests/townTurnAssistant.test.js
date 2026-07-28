import assert from 'node:assert/strict';
import test from 'node:test';

const {
  generateTownTurnPlan,
  normalizeTownTurnPlan
} = await import('../services/townTurnAssistant.js');

test('town turn assistant sends the complete current world state and accepts only its required tool', async () => {
  const context = createTurnContext();
  let captured = null;
  const result = await generateTownTurnPlan(
    { providerType: 'openai', gatewayName: '测试网关', model: 'town-turn-model' },
    context,
    {
      runCompletion: async (settings, messages, tools, executeTool, options) => {
        captured = { settings, messages, tools, options };
        const argumentsValue = createTurnPlan();
        const toolResult = await executeTool('advance_town_world', argumentsValue);
        return {
          toolCalls: [{ name: 'advance_town_world', arguments: argumentsValue, result: toolResult }],
          provider: '测试网关',
          providerType: 'openai',
          model: 'town-turn-model',
          usage: { totalTokens: 222 },
          process: []
        };
      }
    }
  );

  assert.deepEqual(JSON.parse(captured.messages[1].content).currentTownState, context);
  assert.equal(captured.options.toolChoice, 'required');
  assert.equal(captured.tools[0].function.name, 'advance_town_world');
  assert.equal(result.plan.actions.length, 2);
  assert.equal(result.plan.event.eventType, 'resident.social');
  assert.equal(result.provider, '测试网关');
  assert.equal(result.model, 'town-turn-model');
});

test('town turn assistant rejects plain model text even when it contains a valid-looking plan', async () => {
  await assert.rejects(
    () => generateTownTurnPlan(
      { providerType: 'openai', gatewayName: '测试网关', model: 'town-turn-model' },
      createTurnContext(),
      {
        runCompletion: async () => ({
          content: JSON.stringify(createTurnPlan()),
          toolCalls: [],
          process: []
        })
      }
    ),
    /没有通过工具返回有效的世界推演/
  );
});

test('town turn plan rejects unknown residents, unknown locations and duplicate resident actions', () => {
  const context = createTurnContext();

  const unknownResident = createTurnPlan();
  unknownResident.actions[0].residentId = 'resident-missing';
  assert.equal(normalizeTownTurnPlan(unknownResident, context), null);

  const unknownLocation = createTurnPlan();
  unknownLocation.actions[0].locationId = 'location-missing';
  assert.equal(normalizeTownTurnPlan(unknownLocation, context), null);

  const duplicateResident = createTurnPlan();
  duplicateResident.actions[1].residentId = duplicateResident.actions[0].residentId;
  assert.equal(normalizeTownTurnPlan(duplicateResident, context), null);
});

test('town turn plan rejects the whole output when any action is invalid or text exceeds its boundary', () => {
  const context = createTurnContext();
  const invalidExtraAction = createTurnPlan();
  invalidExtraAction.actions.push({
    residentId: 'resident-missing',
    locationId: 'location-bridge',
    activity: '观察桥面',
    intention: '确认异常来源',
    mood: '警觉',
    memory: '我看见了桥上的裂纹。',
    importance: 5
  });
  assert.equal(normalizeTownTurnPlan(invalidExtraAction, context), null);

  const overlongTitle = createTurnPlan();
  overlongTitle.event.title = '事'.repeat(201);
  assert.equal(normalizeTownTurnPlan(overlongTitle, context), null);

  const unknownProperty = createTurnPlan();
  unknownProperty.actions[0].screenX = 50;
  assert.equal(normalizeTownTurnPlan(unknownProperty, context), null);
});

test('town turn plan must answer the exact pending player event and cover every participant with an action', () => {
  const context = createTurnContext({
    pendingIntervention: {
      id: 'event-player-1',
      title: '桥下传来钟声',
      detail: '无人敲钟，但桥下连续响了三次。',
      occurredTick: 600
    }
  });
  const matching = createTurnPlan('event-player-1');
  assert.ok(normalizeTownTurnPlan(matching, context));

  const wrongEvent = createTurnPlan('event-player-old');
  assert.equal(normalizeTownTurnPlan(wrongEvent, context), null);

  const uncoveredParticipant = createTurnPlan('event-player-1');
  uncoveredParticipant.actions.pop();
  assert.equal(normalizeTownTurnPlan(uncoveredParticipant, context), null);
});

function createTurnContext(overrides = {}) {
  return {
    version: { currentDay: 1, minuteOfDay: 600, tick: 600, updatedAt: '2026-07-22T00:00:00.000Z' },
    world: {
      id: 'town-1',
      name: '星落谷',
      description: '陨石雨后的山谷聚落。',
      creationPrompt: '创建一座陨石雨后的山谷聚落。',
      rules: ['居民只依据亲历或听闻的信息行动。'],
      environment: { biome: 'fantasy' }
    },
    time: { currentDay: 1, minuteOfDay: 600, tick: 600, tickMinutes: 15, simulationStatus: 'paused' },
    locations: [
      { id: 'location-bridge', name: '星痕石桥', kind: 'bridge', description: '横跨河谷的旧石桥。', x: 300, y: 220 },
      { id: 'location-garden', name: '鹿鸣药圃', kind: 'garden', description: '种植星尘草的药圃。', x: 820, y: 360 }
    ],
    residents: [
      {
        id: 'resident-keeper', name: '石衡', role: '守桥人', summary: '熟悉石桥异响。', goal: '守住石桥', mood: '警觉',
        currentLocation: '星痕石桥', currentActivity: '检查裂缝', currentIntention: '找到异响来源', currentSchedule: null,
        memories: [{ id: 'memory-1', memoryType: 'event', content: '昨夜桥墩响了三次。', importance: 7, occurredTick: 540 }]
      },
      {
        id: 'resident-herbalist', name: '鹿鸣', role: '药师', summary: '研究变异药草。', goal: '找到星尘草', mood: '专注',
        currentLocation: '鹿鸣药圃', currentActivity: '照料药草', currentIntention: '记录发光规律', currentSchedule: null,
        memories: [{ id: 'memory-2', memoryType: 'observation', content: '药草朝石桥方向发光。', importance: 6, occurredTick: 570 }]
      }
    ],
    recentEvents: [],
    pendingIntervention: null,
    ...overrides
  };
}

function createTurnPlan(respondsToEventId = '') {
  return {
    event: {
      eventType: 'resident.social',
      uiType: 'dialogue',
      title: '石桥异响让两人交换线索',
      detail: '石衡在石桥旁向鹿鸣说明桥墩的三次异响，鹿鸣则发现药草的光正朝石桥偏转。',
      participantIds: ['resident-keeper', 'resident-herbalist'],
      respondsToEventId
    },
    actions: [
      {
        residentId: 'resident-keeper',
        locationId: 'location-bridge',
        activity: '带鹿鸣检查桥墩裂缝',
        intention: '确认异响是否与陨石有关',
        mood: '戒备',
        memory: '我把桥墩三次异响告诉了鹿鸣，并带她查看裂缝。',
        importance: 7
      },
      {
        residentId: 'resident-herbalist',
        locationId: 'location-bridge',
        activity: '比较裂缝与星尘草的光向',
        intention: '验证药草是否回应桥下异响',
        mood: '专注',
        memory: '石衡的描述与星尘草偏转的时刻一致，我开始检查桥墩。',
        importance: 8
      }
    ]
  };
}
