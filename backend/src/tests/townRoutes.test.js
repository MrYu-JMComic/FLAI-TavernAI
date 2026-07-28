import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-town-routes';

const { createAppDatabase } = await import('../db.js');
const {
  TOWN_WORLD_GENERATION_TIMEOUT_DEFAULT_MS,
  TOWN_WORLD_GENERATION_TIMEOUT_MAX_MS,
  TOWN_WORLD_GENERATION_TIMEOUT_MIN_MS,
  readBoundedPositiveInteger
} = await import('../config.js');
const { createTownsRouter } = await import('../routes/towns.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

function createTownRoutesApp(database, userId, options = {}) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.auth = { user: { id: request.headers['x-test-user'] || userId } };
    next();
  });
  app.use('/api/towns', createTownsRouter({
    db: database,
    requireAuth: (_request, _response, next) => next(),
    withListCache: (_request, response, data) => response.json(data),
    getChatProviderSettings: options.getChatProviderSettings || (() => ({
      ok: true,
      value: { providerType: 'openai', gatewayName: '测试网关', model: 'test-world-model' }
    })),
    generateTownWorldBlueprint: options.generateTownWorldBlueprint || (async () => ({
      blueprint: createGeneratedWorldBlueprint(),
      provider: '测试网关',
      providerType: 'openai',
      model: 'test-world-model',
      usage: { totalTokens: 321 }
    })),
    generateTownTurnPlan: options.generateTownTurnPlan || (async (_settings, context) => ({
      plan: createGeneratedTurnPlan(context),
      provider: '测试网关',
      providerType: 'openai',
      model: 'test-turn-model',
      usage: { totalTokens: 123 }
    })),
    generateTownResidentCognitionPlan: options.generateTownResidentCognitionPlan || (async (_settings, context) => ({
      plan: createGeneratedCognitionPlan(context),
      provider: '测试网关',
      providerType: 'openai',
      model: 'test-cognition-model',
      usage: { totalTokens: 234 }
    })),
    townWorldGenerationTimeoutMs: options.townWorldGenerationTimeoutMs
  }));
  app.use((error, _request, response, _next) => {
    response.status(400).json({ error: error.message });
  });
  return app;
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

test('town routes persist an independent world, residents, clock and events', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-route-user');
  insertUser(database, 'town-route-other');
  const app = createTownRoutesApp(database, 'town-route-user');

  await withServer(app, async (baseUrl) => {
    const created = await jsonRequest(baseUrl, '/api/towns', {
      method: 'POST',
      body: JSON.stringify({
        name: '汴京夜肆',
        simulationStatus: 'running',
        currentDay: 2,
        minuteOfDay: 1170
      })
    });
    assert.equal(created.response.status, 201);
    const townId = created.body.id;

    const resident = await jsonRequest(baseUrl, `/api/towns/${townId}/residents`, {
      method: 'POST',
      body: JSON.stringify({ name: '苏捕头', role: '片区捕快', reflectionThreshold: 12 })
    });
    assert.equal(resident.response.status, 201);

    const event = await jsonRequest(baseUrl, `/api/towns/${townId}/events`, {
      method: 'POST',
      body: JSON.stringify({
        residentId: resident.body.id,
        eventType: 'world.intervention',
        title: '当铺门口出现一封信',
        occurredTick: 2610
      })
    });
    assert.equal(event.response.status, 201);

    const clock = await jsonRequest(baseUrl, `/api/towns/${townId}/clock`, {
      method: 'PATCH',
      body: JSON.stringify({ simulationStatus: 'paused', minuteOfDay: 1185 })
    });
    assert.equal(clock.body.simulationStatus, 'paused');
    assert.equal(clock.body.minuteOfDay, 1185);

    const pausedAdvance = await jsonRequest(baseUrl, `/api/towns/${townId}/advance`, {
      method: 'POST',
      body: JSON.stringify({ steps: 1 })
    });
    assert.equal(pausedAdvance.body.advanced, false);

    await jsonRequest(baseUrl, `/api/towns/${townId}/clock`, {
      method: 'PATCH',
      body: JSON.stringify({ simulationStatus: 'running' })
    });
    const advanced = await jsonRequest(baseUrl, `/api/towns/${townId}/advance`, {
      method: 'POST',
      body: JSON.stringify({ steps: 1 })
    });
    assert.equal(advanced.body.advanced, true);
    assert.equal(advanced.body.snapshot.town.minuteOfDay, 1200);

    const snapshot = await jsonRequest(baseUrl, `/api/towns/${townId}/snapshot`);
    assert.equal(snapshot.body.residents.length, 1);
    assert.equal(snapshot.body.town.minuteOfDay, 1200);

    const events = await jsonRequest(baseUrl, `/api/towns/${townId}/events`);
    assert.ok(events.body.some((item) => item.id === event.body.id));
    assert.ok(events.body.some((item) => item.eventType === 'resident.intervention.reaction'));
    const residents = await jsonRequest(baseUrl, `/api/towns/${townId}/residents`);
    assert.deepEqual(residents.body.map((item) => item.id), [resident.body.id]);

    const foreign = await jsonRequest(baseUrl, `/api/towns/${townId}`, {
      headers: { 'X-Test-User': 'town-route-other' }
    });
    assert.equal(foreign.response.status, 404);
  });
  database.close();
});

test('town cognition routes recall memories, expose reflection state and save a schedule', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-cognition-user');
  const app = createTownRoutesApp(database, 'town-cognition-user');

  await withServer(app, async (baseUrl) => {
    const town = (await jsonRequest(baseUrl, '/api/towns', {
      method: 'POST',
      body: JSON.stringify({ name: '认知测试镇', currentDay: 1, minuteOfDay: 600 })
    })).body;
    const resident = (await jsonRequest(baseUrl, `/api/towns/${town.id}/residents`, {
      method: 'POST',
      body: JSON.stringify({ name: '沈月', reflectionThreshold: 10 })
    })).body;

    const memoryIds = [];
    for (const memory of [
      { content: '灯笼摊有人提到失踪账本。', importance: 6 },
      { content: '巡夜人正在寻找账本。', importance: 5 }
    ]) {
      const result = await jsonRequest(baseUrl, `/api/towns/${town.id}/residents/${resident.id}/memories`, {
        method: 'POST',
        body: JSON.stringify(memory)
      });
      assert.equal(result.response.status, 201);
      memoryIds.push(result.body.id);
    }

    const recalled = await jsonRequest(
      baseUrl,
      `/api/towns/${town.id}/residents/${resident.id}/memories/recall?query=${encodeURIComponent('灯笼摊账本')}&limit=1`
    );
    assert.equal(recalled.body[0].id, memoryIds[0]);

    const reflectionStatus = await jsonRequest(
      baseUrl,
      `/api/towns/${town.id}/residents/${resident.id}/reflection-status`
    );
    assert.equal(reflectionStatus.body.shouldReflect, true);

    const reflection = await jsonRequest(baseUrl, `/api/towns/${town.id}/residents/${resident.id}/reflections`, {
      method: 'POST',
      body: JSON.stringify({
        content: '两条消息都指向灯笼摊，我应该亲自去查看。',
        memoryIds,
        importance: 8
      })
    });
    assert.equal(reflection.response.status, 201);

    const schedule = await jsonRequest(baseUrl, `/api/towns/${town.id}/residents/${resident.id}/schedules/1`, {
      method: 'PUT',
      body: JSON.stringify({
        goal: '调查失踪账本',
        items: [
          { startMinute: 600, endMinute: 660, activity: '询问巡夜人' },
          { startMinute: 660, endMinute: 720, activity: '前往灯笼摊' }
        ]
      })
    });
    assert.equal(schedule.response.status, 200);
    assert.equal(schedule.body.items.length, 2);

    const loaded = await jsonRequest(
      baseUrl,
      `/api/towns/${town.id}/residents/${resident.id}/schedules/1`
    );
    assert.equal(loaded.body.goal, '调查失踪账本');
  });
  database.close();
});

test('town generation route sends the untouched natural-language idea to AI and persists its blueprint', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-generate-user');
  const prompt = '请创建一座陨石雨后的山谷聚落。药师鹿鸣正在寻找会发光的星尘草，而守桥人怀疑夜空中的光正在召唤什么。';
  let receivedPrompt = '';
  const app = createTownRoutesApp(database, 'town-generate-user', {
    generateTownWorldBlueprint: async (_settings, worldIdea) => {
      receivedPrompt = worldIdea;
      return {
        blueprint: createGeneratedWorldBlueprint(),
        provider: '测试网关',
        providerType: 'openai',
        model: 'test-world-model',
        usage: { totalTokens: 321 }
      };
    }
  });

  await withServer(app, async (baseUrl) => {
    const generated = await jsonRequest(baseUrl, '/api/towns/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt
      })
    });
    assert.equal(generated.response.status, 201);
    assert.equal(receivedPrompt, prompt);
    assert.equal(generated.body.town.name, '星落谷');
    assert.deepEqual(new Set(generated.body.residents.map((resident) => resident.name)), new Set(['鹿鸣', '石衡']));
    assert.equal(generated.body.events[0].detail, '夜空再次亮起，石桥下传来低沉回声。');
    assert.equal(generated.body.town.mapConfig.renderMode, 'procedural-v1');
    assert.equal(generated.body.generation.mode, 'ai');
    assert.equal(generated.body.generation.model, 'test-world-model');

    const towns = await jsonRequest(baseUrl, '/api/towns');
    assert.equal(towns.body.length, 1);
    assert.equal(towns.body[0].creationPrompt, prompt);
  });
  database.close();
});

test('town world generation timeout defaults to eight minutes and clamps configuration to safe bounds', () => {
  assert.equal(TOWN_WORLD_GENERATION_TIMEOUT_DEFAULT_MS, 8 * 60 * 1000);
  assert.equal(
    readBoundedPositiveInteger(
      '',
      TOWN_WORLD_GENERATION_TIMEOUT_DEFAULT_MS,
      TOWN_WORLD_GENERATION_TIMEOUT_MIN_MS,
      TOWN_WORLD_GENERATION_TIMEOUT_MAX_MS
    ),
    TOWN_WORLD_GENERATION_TIMEOUT_DEFAULT_MS
  );
  assert.equal(
    readBoundedPositiveInteger(
      1,
      TOWN_WORLD_GENERATION_TIMEOUT_DEFAULT_MS,
      TOWN_WORLD_GENERATION_TIMEOUT_MIN_MS,
      TOWN_WORLD_GENERATION_TIMEOUT_MAX_MS
    ),
    TOWN_WORLD_GENERATION_TIMEOUT_MIN_MS
  );
  assert.equal(
    readBoundedPositiveInteger(
      60 * 60 * 1000,
      TOWN_WORLD_GENERATION_TIMEOUT_DEFAULT_MS,
      TOWN_WORLD_GENERATION_TIMEOUT_MIN_MS,
      TOWN_WORLD_GENERATION_TIMEOUT_MAX_MS
    ),
    TOWN_WORLD_GENERATION_TIMEOUT_MAX_MS
  );
});

test('town generation route honors a longer injected wait and still creates the AI-authored world', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-generate-wait-user');
  const app = createTownRoutesApp(database, 'town-generate-wait-user', {
    townWorldGenerationTimeoutMs: 80,
    generateTownWorldBlueprint: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        blueprint: createGeneratedWorldBlueprint(),
        provider: '测试网关',
        providerType: 'openai',
        model: 'slow-test-world-model',
        usage: { totalTokens: 654 }
      };
    }
  });

  await withServer(app, async (baseUrl) => {
    const generated = await jsonRequest(baseUrl, '/api/towns/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: '创建一座需要模型仔细构思的漫长历史世界。' })
    });
    assert.equal(generated.response.status, 201);
    assert.equal(generated.body.town.name, '星落谷');
    assert.equal(generated.body.generation.model, 'slow-test-world-model');
  });
  database.close();
});

test('town generation route returns 504 with stage and duration when its configured deadline expires', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-generate-timeout-user');
  let abortReason = '';
  const app = createTownRoutesApp(database, 'town-generate-timeout-user', {
    townWorldGenerationTimeoutMs: 20,
    generateTownWorldBlueprint: async (_settings, _prompt, options) => new Promise((resolve, reject) => {
      const handleAbort = () => {
        abortReason = options.signal.reason?.message || '';
        reject(options.signal.reason);
      };
      if (options.signal.aborted) {
        handleAbort();
        return;
      }
      options.signal.addEventListener('abort', handleAbort, { once: true });
    })
  });

  await withServer(app, async (baseUrl) => {
    const generated = await jsonRequest(baseUrl, '/api/towns/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: '创建一座模型暂时无法及时完成的世界。' })
    });
    assert.equal(generated.response.status, 504);
    assert.match(generated.body.error, /AI 世界生成阶段/);
    assert.match(generated.body.error, /20 毫秒/);
    assert.equal(abortReason, generated.body.error);

    const towns = await jsonRequest(baseUrl, '/api/towns');
    assert.deepEqual(towns.body, []);
  });
  database.close();
});

test('town generation route fails clearly when no usable model is configured', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-generate-no-model');
  let generatorCalled = false;
  const app = createTownRoutesApp(database, 'town-generate-no-model', {
    getChatProviderSettings: () => ({ ok: false, error: '请先保存 API Key / SK。' }),
    generateTownWorldBlueprint: async () => {
      generatorCalled = true;
      return { blueprint: createGeneratedWorldBlueprint() };
    }
  });

  await withServer(app, async (baseUrl) => {
    const generated = await jsonRequest(baseUrl, '/api/towns/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: '创建一座漂浮在云海中的城市。' })
    });
    assert.equal(generated.response.status, 400);
    assert.match(generated.body.error, /AI 世界生成需要可用模型/);
    assert.match(generated.body.error, /API Key/);
    assert.equal(generatorCalled, false);
  });
  database.close();
});

test('town AI advance route sends the current paused world to the model and persists the validated turn', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-ai-route-user');
  let receivedContext = null;
  const app = createTownRoutesApp(database, 'town-ai-route-user', {
    generateTownTurnPlan: async (_settings, context) => {
      receivedContext = context;
      return {
        plan: createGeneratedTurnPlan(context),
        provider: '测试网关',
        providerType: 'openai',
        model: 'test-turn-model',
        usage: { totalTokens: 123 }
      };
    }
  });

  await withServer(app, async (baseUrl) => {
    const generated = await jsonRequest(baseUrl, '/api/towns/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: '创建一座陨石雨后的山谷聚落。' })
    });
    const townId = generated.body.town.id;
    const advanced = await jsonRequest(baseUrl, `/api/towns/${townId}/advance-ai`, {
      method: 'POST'
    });

    assert.equal(advanced.response.status, 200);
    assert.equal(receivedContext.world.id, townId);
    assert.equal(receivedContext.time.simulationStatus, 'paused');
    assert.equal(receivedContext.residents.length, 2);
    assert.equal(advanced.body.snapshot.town.minuteOfDay, 495);
    assert.equal(advanced.body.generated.event.source, 'ai-town-engine');
    assert.equal(advanced.body.generation.mode, 'ai-step');
    assert.equal(advanced.body.generation.model, 'test-turn-model');
  });
  database.close();
});

test('town AI advance route rejects missing or mock models before calling the generator', async () => {
  for (const [suffix, settings, errorPattern] of [
    ['missing', { ok: false, error: '请先保存 API Key / SK。' }, /AI 世界推演需要可用模型/],
    ['mock', { ok: true, value: { providerType: 'mock', model: 'mock-local' } }, /不能使用本地模拟结果/]
  ]) {
    const database = createAppDatabase(':memory:');
    const userId = `town-ai-route-${suffix}`;
    insertUser(database, userId);
    let generatorCalled = false;
    const app = createTownRoutesApp(database, userId, {
      getChatProviderSettings: () => settings,
      generateTownTurnPlan: async () => {
        generatorCalled = true;
        return {};
      }
    });

    await withServer(app, async (baseUrl) => {
      const town = await jsonRequest(baseUrl, '/api/towns', {
        method: 'POST',
        body: JSON.stringify({ name: '暂停测试世界', simulationStatus: 'paused' })
      });
      const advanced = await jsonRequest(baseUrl, `/api/towns/${town.body.id}/advance-ai`, {
        method: 'POST'
      });
      assert.equal(advanced.response.status, 400);
      assert.match(advanced.body.error, errorPattern);
      assert.equal(generatorCalled, false);
    });
    database.close();
  }
});

test('town AI advance route rejects a running world before reading model settings or generating', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-ai-route-running');
  let settingsCalled = false;
  let generatorCalled = false;
  const app = createTownRoutesApp(database, 'town-ai-route-running', {
    getChatProviderSettings: () => {
      settingsCalled = true;
      return { ok: true, value: { providerType: 'openai', model: 'test-turn-model' } };
    },
    generateTownTurnPlan: async () => {
      generatorCalled = true;
      return {};
    }
  });

  await withServer(app, async (baseUrl) => {
    const town = await jsonRequest(baseUrl, '/api/towns', {
      method: 'POST',
      body: JSON.stringify({ name: '运行中的测试世界', simulationStatus: 'running' })
    });
    const advanced = await jsonRequest(baseUrl, `/api/towns/${town.body.id}/advance-ai`, {
      method: 'POST'
    });
    assert.equal(advanced.response.status, 409);
    assert.match(advanced.body.error, /请先暂停世界/);
    assert.equal(settingsCalled, false);
    assert.equal(generatorCalled, false);
  });
  database.close();
});

test('town resident cognition route sends current evidence to AI and persists reflection plus schedule', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-cognition-route-user');
  let receivedContext = null;
  const app = createTownRoutesApp(database, 'town-cognition-route-user', {
    generateTownResidentCognitionPlan: async (_settings, context) => {
      receivedContext = context;
      return {
        plan: createGeneratedCognitionPlan(context),
        provider: '测试网关',
        providerType: 'openai',
        model: 'test-cognition-model',
        usage: { totalTokens: 234 }
      };
    }
  });

  await withServer(app, async (baseUrl) => {
    const generated = await jsonRequest(baseUrl, '/api/towns/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: '创建一座陨石雨后的山谷聚落。' })
    });
    const townId = generated.body.town.id;
    const residentId = generated.body.residents[0].id;
    await jsonRequest(baseUrl, `/api/towns/${townId}/residents/${residentId}/memories`, {
      method: 'POST',
      body: JSON.stringify({ content: '桥下的新回声与昨夜记忆互相呼应。', importance: 4 })
    });

    const before = await jsonRequest(baseUrl, `/api/towns/${townId}/residents/${residentId}/cognition`);
    assert.equal(before.response.status, 200);
    assert.equal(before.body.reflectionStatus.shouldReflect, true);
    assert.equal(before.body.schedule, null);

    const planned = await jsonRequest(baseUrl, `/api/towns/${townId}/residents/${residentId}/cognition-ai`, {
      method: 'POST'
    });
    assert.equal(planned.response.status, 200);
    assert.equal(receivedContext.resident.id, residentId);
    assert.equal(receivedContext.time.simulationStatus, 'paused');
    assert.equal(receivedContext.reflectionStatus.shouldReflect, true);
    assert.ok(receivedContext.unreflectedMemories.length >= 3);
    assert.ok(planned.body.generated.reflection.content.includes('同一条线索'));
    assert.equal(planned.body.generated.schedule.items.length, 2);
    assert.equal(planned.body.generation.mode, 'ai-cognition');
    assert.equal(planned.body.generation.model, 'test-cognition-model');
    assert.equal(planned.body.snapshot.residents.find((resident) => resident.id === residentId).currentLocation, '星痕石桥');

    const after = await jsonRequest(baseUrl, `/api/towns/${townId}/residents/${residentId}/cognition`);
    assert.equal(after.body.reflections.length, 1);
    assert.equal(after.body.schedule.goal, '确认桥下异响是否会引导星尘草发光');
    assert.equal(after.body.schedule.items[0].location, '星痕石桥');
  });
  database.close();
});

test('town resident cognition route rejects a running world before reading model settings or generating', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'town-cognition-route-running');
  let settingsCalled = false;
  let generatorCalled = false;
  const app = createTownRoutesApp(database, 'town-cognition-route-running', {
    getChatProviderSettings: () => {
      settingsCalled = true;
      return { ok: true, value: { providerType: 'openai', model: 'test-cognition-model' } };
    },
    generateTownResidentCognitionPlan: async () => {
      generatorCalled = true;
      return {};
    }
  });

  await withServer(app, async (baseUrl) => {
    const town = await jsonRequest(baseUrl, '/api/towns', {
      method: 'POST',
      body: JSON.stringify({ name: '运行中的认知测试世界', simulationStatus: 'running' })
    });
    const resident = await jsonRequest(baseUrl, `/api/towns/${town.body.id}/residents`, {
      method: 'POST',
      body: JSON.stringify({ name: '认知测试居民' })
    });
    const planned = await jsonRequest(
      baseUrl,
      `/api/towns/${town.body.id}/residents/${resident.body.id}/cognition-ai`,
      { method: 'POST' }
    );
    assert.equal(planned.response.status, 409);
    assert.match(planned.body.error, /请先暂停世界/);
    assert.equal(settingsCalled, false);
    assert.equal(generatorCalled, false);
  });
  database.close();
});

function createGeneratedWorldBlueprint() {
  return {
    name: '星落谷',
    description: '陨石雨后的山谷聚落，居民正在追查夜空异象留下的变化。',
    environment: {
      biome: 'fantasy',
      atmosphere: '夜色中漂浮着细碎星尘。',
      settlementPattern: 'radial',
      water: 'river'
    },
    locations: [
      { id: 'location-1', name: '星痕石桥', kind: 'bridge', description: '横跨发光河谷的旧石桥。', importance: 5 },
      { id: 'location-2', name: '鹿鸣药圃', kind: 'herb-garden', description: '种植山谷药草的阶梯田。', importance: 4 },
      { id: 'location-3', name: '坠星观测台', kind: 'observatory', description: '记录陨石轨迹的高台。', importance: 4 }
    ],
    residents: [
      {
        name: '鹿鸣', role: '药师', summary: '研究陨石雨后变异植物的年轻药师。', goal: '找到能稳定伤者梦境的星尘草', mood: '专注',
        startingLocation: '鹿鸣药圃', activities: ['照料变异药草', '拜访伤者记录梦境'], dialogue: ['星尘草只在最安静的夜里发光。', '这些梦不像是病，更像某种召唤。'], memories: ['陨石雨当晚，河谷里的草叶同时转向北方。']
      },
      {
        name: '石衡', role: '守桥人', summary: '沉默的守桥人，熟悉河流每一次异常回声。', goal: '阻止未知存在通过石桥进入聚落', mood: '不安',
        startingLocation: '星痕石桥', activities: ['检查桥面裂缝', '倾听桥下回声'], dialogue: ['昨夜桥下有人叫我的名字。', '太阳落山后不要独自过桥。'], memories: ['他在陨石落下前听见桥墩内部传来三次敲击。']
      }
    ],
    openingEvents: ['夜空再次亮起，石桥下传来低沉回声。'],
    rules: ['星尘会放大接触者近期最强烈的记忆。', '河谷的道路会在陨石雨后缓慢改变。']
  };
}

function createGeneratedTurnPlan(context) {
  const [firstResident, secondResident] = context.residents;
  const [firstLocation, secondLocation] = context.locations;
  return {
    event: {
      eventType: 'resident.social',
      uiType: 'dialogue',
      title: `${firstResident.name}与${secondResident.name}交换了新线索`,
      detail: `${firstResident.name}依据近期记忆提出疑问，${secondResident.name}决定与其一同调查。`,
      participantIds: [firstResident.id, secondResident.id],
      respondsToEventId: context.pendingIntervention?.id || ''
    },
    actions: [
      {
        residentId: firstResident.id,
        locationId: secondLocation.id,
        activity: `前往${secondLocation.name}交换线索`,
        intention: firstResident.goal,
        mood: '警觉',
        memory: `我前往${secondLocation.name}与${secondResident.name}交换了线索。`,
        importance: 7
      },
      {
        residentId: secondResident.id,
        locationId: firstLocation.id,
        activity: `前往${firstLocation.name}核实线索`,
        intention: secondResident.goal,
        mood: '专注',
        memory: `我答应与${firstResident.name}一起前往${firstLocation.name}调查。`,
        importance: 7
      }
    ]
  };
}

function createGeneratedCognitionPlan(context) {
  const [firstLocation, secondLocation] = context.locations;
  return {
    reflection: context.reflectionStatus.shouldReflect
      ? {
        create: true,
        content: '桥下异响和近期发现可能是同一条线索，我应按时间与地点逐一核对。',
        evidenceMemoryIds: context.unreflectedMemories.slice(0, 3).map((memory) => memory.id),
        importance: 8
      }
      : { create: false, content: '', evidenceMemoryIds: [], importance: 1 },
    schedule: {
      goal: '确认桥下异响是否会引导星尘草发光',
      items: [
        {
          startMinute: 360,
          endMinute: 600,
          activity: `在${firstLocation.name}检查异常`,
          locationId: firstLocation.id,
          intention: '记录异常出现的准确方位'
        },
        {
          startMinute: 600,
          endMinute: 900,
          activity: `前往${secondLocation.name}比较线索`,
          locationId: secondLocation.id,
          intention: '验证两处异常是否互相关联'
        }
      ]
    }
  };
}
