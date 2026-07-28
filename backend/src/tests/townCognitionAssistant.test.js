import assert from 'node:assert/strict';
import test from 'node:test';

const {
  generateTownResidentCognitionPlan,
  normalizeTownResidentCognitionPlan
} = await import('../services/townCognitionAssistant.js');

test('town cognition assistant sends the complete resident context and accepts only its required tool', async () => {
  const context = createCognitionContext();
  const signal = new AbortController().signal;
  let captured = null;
  const result = await generateTownResidentCognitionPlan(
    { providerType: 'openai', gatewayName: '测试网关', model: 'cognition-model' },
    context,
    {
      signal,
      runCompletion: async (settings, messages, tools, executeTool, options) => {
        captured = { settings, messages, tools, options };
        const argumentsValue = createCognitionPlan();
        const toolResult = await executeTool('plan_town_resident_cognition', argumentsValue);
        return {
          toolCalls: [{ name: 'plan_town_resident_cognition', arguments: argumentsValue, result: toolResult }],
          provider: '测试网关',
          providerType: 'openai',
          model: 'cognition-model',
          usage: { totalTokens: 333 },
          process: []
        };
      }
    }
  );

  assert.deepEqual(JSON.parse(captured.messages[1].content).currentResidentCognition, context);
  assert.equal(captured.options.toolChoice, 'required');
  assert.equal(captured.options.signal, signal);
  assert.equal(captured.tools[0].function.name, 'plan_town_resident_cognition');
  assert.equal(result.plan.reflection.evidenceMemoryIds[0], 'memory-bridge');
  assert.equal(result.plan.schedule.items[1].locationId, 'location-garden');
  assert.equal(result.provider, '测试网关');
  assert.equal(result.model, 'cognition-model');
});

test('town cognition assistant rejects plain model text even when it contains a valid-looking plan', async () => {
  await assert.rejects(
    () => generateTownResidentCognitionPlan(
      { providerType: 'openai', gatewayName: '测试网关', model: 'cognition-model' },
      createCognitionContext(),
      {
        runCompletion: async () => ({
          content: JSON.stringify(createCognitionPlan()),
          toolCalls: [],
          process: []
        })
      }
    ),
    /没有通过工具返回有效的居民反思与日程/
  );
});

test('town cognition plan rejects unknown evidence, unknown locations, overlapping time and extra fields', () => {
  const context = createCognitionContext();

  const unknownEvidence = createCognitionPlan();
  unknownEvidence.reflection.evidenceMemoryIds = ['memory-missing'];
  assert.equal(normalizeTownResidentCognitionPlan(unknownEvidence, context), null);

  const unknownLocation = createCognitionPlan();
  unknownLocation.schedule.items[0].locationId = 'location-missing';
  assert.equal(normalizeTownResidentCognitionPlan(unknownLocation, context), null);

  const overlapping = createCognitionPlan();
  overlapping.schedule.items[1].startMinute = 650;
  assert.equal(normalizeTownResidentCognitionPlan(overlapping, context), null);

  const extraField = createCognitionPlan();
  extraField.schedule.items[0].screenX = 50;
  assert.equal(normalizeTownResidentCognitionPlan(extraField, context), null);
});

test('town cognition plan follows the server reflection threshold and must cover the current time', () => {
  const belowThreshold = createCognitionContext({
    reflectionStatus: {
      residentId: 'resident-keeper',
      memoryCount: 1,
      importanceTotal: 7,
      threshold: 15,
      shouldReflect: false
    }
  });
  assert.equal(normalizeTownResidentCognitionPlan(createCognitionPlan(), belowThreshold), null);

  const noReflection = createCognitionPlan();
  noReflection.reflection = { create: false, content: '', evidenceMemoryIds: [], importance: 1 };
  assert.ok(normalizeTownResidentCognitionPlan(noReflection, belowThreshold));

  const uncovered = createCognitionPlan();
  uncovered.schedule.items = [
    { startMinute: 360, endMinute: 540, activity: '巡查石桥', locationId: 'location-bridge', intention: '确认桥面安全' },
    { startMinute: 720, endMinute: 900, activity: '拜访药圃', locationId: 'location-garden', intention: '交换异响线索' }
  ];
  assert.equal(normalizeTownResidentCognitionPlan(uncovered, createCognitionContext()), null);
});

function createCognitionContext(overrides = {}) {
  return {
    version: {
      tick: 600,
      townUpdatedAt: '2026-07-22T00:00:00.000Z',
      residentUpdatedAt: '2026-07-22T00:00:00.000Z',
      scheduleUpdatedAt: '',
      lastReflectionAt: '',
      unreflectedMemoryIds: ['memory-bridge', 'memory-herb']
    },
    world: {
      id: 'town-1',
      name: '星落谷',
      description: '陨石雨后的山谷聚落。',
      creationPrompt: '创建一座陨石雨后的山谷聚落。',
      rules: ['居民只依据亲历或听闻的信息行动。'],
      environment: { biome: 'fantasy' }
    },
    time: { currentDay: 1, minuteOfDay: 600, targetDay: 1, tick: 600, simulationStatus: 'paused' },
    locations: [
      { id: 'location-bridge', name: '星痕石桥', kind: 'bridge', description: '横跨河谷的旧桥。', x: 300, y: 220 },
      { id: 'location-garden', name: '鹿鸣药圃', kind: 'garden', description: '种植星尘草的药圃。', x: 800, y: 360 }
    ],
    resident: {
      id: 'resident-keeper',
      name: '石衡',
      role: '守桥人',
      summary: '熟悉桥下每一次异响。',
      goal: '阻止未知存在越过石桥',
      mood: '警觉',
      currentLocation: '星痕石桥',
      currentActivity: '检查裂缝',
      currentIntention: '确认异响来源',
      reflectionThreshold: 15
    },
    reflectionStatus: {
      residentId: 'resident-keeper',
      memoryCount: 2,
      importanceTotal: 16,
      threshold: 15,
      shouldReflect: true
    },
    unreflectedMemories: [
      { id: 'memory-bridge', memoryType: 'event', content: '桥墩连续响了三次。', importance: 8, occurredTick: 540 },
      { id: 'memory-herb', memoryType: 'relationship', content: '鹿鸣说药草朝石桥发光。', importance: 8, occurredTick: 570 }
    ],
    retrievedMemories: [],
    recentReflections: [],
    recentEvents: [],
    existingSchedule: null,
    ...overrides
  };
}

function createCognitionPlan() {
  return {
    reflection: {
      create: true,
      content: '桥墩异响与星尘草偏转发生在同一时刻，我应把两处异常放在一起调查。',
      evidenceMemoryIds: ['memory-bridge', 'memory-herb'],
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
