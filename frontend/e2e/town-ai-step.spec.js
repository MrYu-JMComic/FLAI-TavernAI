import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

let providerServer = null;
let providerBaseUrl = '';
let lastProviderRequest = null;
let lastCognitionProviderRequest = null;

test.beforeAll(async () => {
  providerServer = http.createServer((request, response) => {
    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'town-tool-model', object: 'model' }] }));
      return;
    }
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const stateMessage = body.messages.find((message) => message.role === 'user');
        const messageState = JSON.parse(stateMessage.content);
        const requestedTool = body.tools?.[0]?.function?.name;
        if (requestedTool === 'plan_town_resident_cognition') {
          const context = messageState.currentResidentCognition;
          const [firstLocation, secondLocation] = context.locations;
          const evidenceMemoryIds = context.unreflectedMemories.slice(0, 2).map((memory) => memory.id);
          const plan = {
            reflection: {
              create: true,
              content: '桥墩异响与星尘草偏转发生在同一时段，我应把两处异常作为同一条因果线索核对。',
              evidenceMemoryIds,
              importance: 9
            },
            schedule: {
              goal: '先核对星尘草的光向，再回到石桥验证回声与光向的对应关系',
              items: [
                {
                  startMinute: 540,
                  endMinute: 660,
                  activity: `在${secondLocation.name}比对星尘草光向`,
                  locationId: secondLocation.id,
                  intention: '确认药草偏转是否与桥下异响同步'
                },
                {
                  startMinute: 660,
                  endMinute: 840,
                  activity: `回到${firstLocation.name}记录桥墩回声`,
                  locationId: firstLocation.id,
                  intention: '验证回声方位与药草光向的关联'
                }
              ]
            }
          };
          lastCognitionProviderRequest = { body, context, plan };
          sendToolCompletion(response, {
            id: 'chatcmpl-town-cognition-e2e',
            callId: 'call-town-cognition-e2e',
            toolName: 'plan_town_resident_cognition',
            argumentsValue: plan
          });
          return;
        }

        const state = messageState.currentTownState;
        lastProviderRequest = { body, state };
        const [firstResident, secondResident] = state.residents;
        const [firstLocation, secondLocation] = state.locations;
        const pendingEventId = state.pendingIntervention?.id || '';
        const plan = {
          event: {
            eventType: pendingEventId ? 'resident.intervention.reaction' : 'resident.social',
            uiType: pendingEventId ? 'clue' : 'dialogue',
            title: `${firstResident.name}与${secondResident.name}回应了桥下钟声`,
            detail: `${firstResident.name}依据近期记忆提出线索，${secondResident.name}决定前往另一处地点共同核实。`,
            participantIds: [firstResident.id, secondResident.id],
            respondsToEventId: pendingEventId
          },
          actions: [
            {
              residentId: firstResident.id,
              locationId: secondLocation.id,
              activity: `前往${secondLocation.name}核实钟声线索`,
              intention: firstResident.goal,
              mood: '警觉',
              memory: `我前往${secondLocation.name}核实了桥下钟声的线索。`,
              importance: 8
            },
            {
              residentId: secondResident.id,
              locationId: firstLocation.id,
              activity: `前往${firstLocation.name}比较发光药草`,
              intention: secondResident.goal,
              mood: '专注',
              memory: `我与${firstResident.name}在${firstLocation.name}比较了药草与钟声。`,
              importance: 8
            }
          ]
        };
        sendToolCompletion(response, {
          id: 'chatcmpl-town-ai-e2e',
          callId: 'call-town-ai-e2e',
          toolName: 'advance_town_world',
          argumentsValue: plan
        });
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: error.message } }));
      }
    });
  });
  await new Promise((resolve, reject) => {
    providerServer.once('error', reject);
    providerServer.listen(0, '127.0.0.1', resolve);
  });
  const address = providerServer.address();
  providerBaseUrl = `http://127.0.0.1:${address.port}/v1`;
});

test.afterAll(async () => {
  if (!providerServer) return;
  providerServer.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    providerServer.close((error) => (error ? reject(error) : resolve()));
  });
});

test('advances a paused generated-map town through a validated AI tool turn on desktop and mobile', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const account = await registerUser(page);
  const suffix = account.suffix || uniqueSuffix();
  await apiRequest(page, '/api/settings/provider', {
    method: 'PUT',
    body: {
      providerType: 'custom',
      gatewayName: 'E2E Town Provider',
      baseUrl: providerBaseUrl,
      model: 'town-tool-model',
      supportsReasoning: false,
      extraBody: '{}'
    }
  });
  const town = await apiRequest(page, '/api/towns', {
    method: 'POST',
    body: createTownPayload(suffix)
  });
  const keeper = await createResident(page, town.id, {
    name: `石衡 ${suffix}`,
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
  const herbalist = await createResident(page, town.id, {
    name: `鹿鸣 ${suffix}`,
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
  await seedResidentContext(page, town.id, keeper, {
    activity: '检查桥面裂缝',
    location: '星痕石桥',
    memory: '昨夜桥墩内部连续响了三次。'
  });
  await seedResidentContext(page, town.id, herbalist, {
    activity: '照料发光药草',
    location: '鹿鸣药圃',
    memory: '星尘草在桥墩异响后转向石桥。'
  });
  const intervention = await apiRequest(page, `/api/towns/${town.id}/events`, {
    method: 'POST',
    body: {
      eventType: 'world.intervention',
      source: 'player',
      title: '桥下无人敲钟却响了三次',
      detail: '这件事应由居民依据当前目标和记忆继续调查。',
      payload: { uiType: 'intervention' },
      occurredTick: 600
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?townQa=${suffix}#/town`);
  await expect(page).toHaveURL(/#\/town$/);
  await expect(page.getByLabel('切换世界')).toHaveValue(town.id);
  await expect(page.getByText('已暂停 · 第 1 天 · 10:00')).toBeVisible();
  await expect(page.locator('canvas[role="img"]')).toBeVisible();
  const aiButton = page.getByRole('button', { name: '让 AI 推演世界下一步' });
  await expect(aiButton).toBeEnabled();

  const keeperAgent = page.locator('.town-agent').filter({ hasText: keeper.name });
  const beforeLeft = await keeperAgent.evaluate((element) => element.style.left);
  await aiButton.click();
  await expect(page.getByText('已暂停 · 第 1 天 · 10:15')).toBeVisible();
  await expect(page.getByText(/AI 已通过 E2E Town Provider · town-tool-model 推演世界 15 分钟/)).toBeVisible();
  await expect(keeperAgent).toContainText('鹿鸣药圃');
  const afterLeft = await keeperAgent.evaluate((element) => element.style.left);
  expect(afterLeft).not.toBe(beforeLeft);

  expect(lastProviderRequest.body.tool_choice).toBe('required');
  expect(lastProviderRequest.state.world.creationPrompt).toContain(`自然语言世界构想 ${suffix}`);
  expect(lastProviderRequest.state.pendingIntervention.id).toBe(intervention.id);
  expect(lastProviderRequest.state.residents.every((resident) => resident.currentSchedule)).toBe(true);
  expect(lastProviderRequest.state.residents.every((resident) => resident.memories.length > 0)).toBe(true);

  const events = await apiRequest(page, `/api/towns/${town.id}/events?limit=50`);
  const aiEvent = events.find((event) => event.source === 'ai-town-engine');
  expect(aiEvent.payload.respondsToEventId).toBe(intervention.id);
  expect(events.find((event) => event.id === intervention.id).handledAt).not.toBe('');

  await page.getByRole('button', { name: '打开时间线' }).click();
  const timeline = page.getByRole('complementary', { name: '完整世界时间线' });
  await expect(timeline).toContainText('AI 推演');
  await expect(timeline).toContainText('回应了桥下钟声');
  await page.screenshot({ path: path.join(os.tmpdir(), 'flai-town-ai-desktop.png'), fullPage: false });
  await timeline.getByRole('button', { name: '关闭时间线' }).click();

  await page.getByRole('button', { name: '继续运行' }).click();
  await expect(page.getByRole('button', { name: '暂停世界后使用 AI 推演' })).toBeDisabled();
  await page.getByRole('button', { name: '暂停运行' }).click();
  await expect(page.getByRole('button', { name: '让 AI 推演世界下一步' })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '让 AI 推演世界下一步' })).toBeVisible();
  await expect(page.getByRole('button', { name: '投放世界事件' })).toBeVisible();
  const hasCommandOverflow = await page.locator('.town-command-actions').evaluate((element) => (
    element.scrollWidth > element.clientWidth
  ));
  expect(hasCommandOverflow).toBe(false);
  const hasPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasPageOverflow).toBe(false);
  await page.screenshot({ path: path.join(os.tmpdir(), 'flai-town-ai-mobile.png'), fullPage: false });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('reflects and plans one resident through the real backend cognition route on desktop and mobile', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const account = await registerUser(page);
  const suffix = account.suffix || uniqueSuffix();
  await apiRequest(page, '/api/settings/provider', {
    method: 'PUT',
    body: {
      providerType: 'custom',
      gatewayName: 'E2E Cognition Provider',
      baseUrl: providerBaseUrl,
      model: 'town-tool-model',
      supportsReasoning: false,
      extraBody: '{}'
    }
  });
  const town = await apiRequest(page, '/api/towns', {
    method: 'POST',
    body: createTownPayload(`cognition-${suffix}`)
  });
  const keeper = await createResident(page, town.id, {
    name: `石衡 ${suffix}`,
    role: '守桥人',
    currentLocation: '星痕石桥',
    reflectionThreshold: 15,
    profile: {
      summary: '熟悉石桥与药圃之间每一次异常。',
      goal: '确认桥下异响与星尘草偏转是否相互关联',
      activities: ['巡查石桥', '核对星尘草光向']
    },
    state: {
      mood: '警觉',
      currentActivity: '检查桥面裂缝',
      currentIntention: '确认桥墩异响来源',
      mapX: 330,
      mapY: 240
    }
  });
  const firstMemory = await apiRequest(page, `/api/towns/${town.id}/residents/${keeper.id}/memories`, {
    method: 'POST',
    body: {
      memoryType: 'event',
      content: '昨夜桥墩内部连续响了三次。',
      importance: 8,
      occurredTick: 540
    }
  });
  const secondMemory = await apiRequest(page, `/api/towns/${town.id}/residents/${keeper.id}/memories`, {
    method: 'POST',
    body: {
      memoryType: 'relationship',
      content: '药师发现星尘草在异响后朝石桥偏转。',
      importance: 8,
      occurredTick: 570
    }
  });
  await apiRequest(page, `/api/towns/${town.id}/events`, {
    method: 'POST',
    body: {
      residentId: keeper.id,
      eventType: 'resident.discovery',
      source: 'town-engine',
      title: '星尘草朝石桥偏转',
      detail: '药师把刚刚记录的异常光向告诉了守桥人。',
      payload: { uiType: 'clue', participantIds: [keeper.id] },
      occurredTick: 580
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?townCognitionQa=${suffix}#/town`);
  await expect(page).toHaveURL(/#\/town$/);
  await expect(page.getByLabel('切换世界')).toHaveValue(town.id);
  await expect(page.getByText('已暂停 · 第 1 天 · 10:00')).toBeVisible();

  const keeperMapAgent = page.locator('.town-agent').filter({ hasText: keeper.name });
  const beforeLeft = await keeperMapAgent.evaluate((element) => element.style.left);
  await page.locator('.town-agent-row').filter({ hasText: keeper.name }).click();
  await page.getByRole('tab', { name: '认知' }).click();
  await expect(page.getByText('16 / 15')).toBeVisible();
  await expect(page.getByText(/已达到阈值，AI 将基于 2 条未处理记忆形成反思/)).toBeVisible();

  await page.getByRole('button', { name: `让 ${keeper.name} 进行 AI 反思与规划` }).click();
  await expect(page.getByText(/AI 已通过 E2E Cognition Provider · town-tool-model 为.*形成反思并规划了当天日程/)).toBeVisible();
  await expect(page.getByText('桥墩异响与星尘草偏转发生在同一时段，我应把两处异常作为同一条因果线索核对。')).toBeVisible();
  await expect(page.getByText('目标：先核对星尘草的光向，再回到石桥验证回声与光向的对应关系')).toBeVisible();
  await expect(page.getByText('在鹿鸣药圃比对星尘草光向')).toBeVisible();
  await expect(keeperMapAgent).toContainText('鹿鸣药圃');
  const afterLeft = await keeperMapAgent.evaluate((element) => element.style.left);
  expect(afterLeft).not.toBe(beforeLeft);

  expect(lastCognitionProviderRequest.body.tool_choice).toBe('required');
  expect(lastCognitionProviderRequest.context.world.creationPrompt).toContain(`自然语言世界构想 cognition-${suffix}`);
  expect(lastCognitionProviderRequest.context.reflectionStatus.shouldReflect).toBe(true);
  expect(new Set(lastCognitionProviderRequest.plan.reflection.evidenceMemoryIds)).toEqual(
    new Set([firstMemory.id, secondMemory.id])
  );
  expect(lastCognitionProviderRequest.context.recentEvents.some((event) => event.title === '星尘草朝石桥偏转')).toBe(true);

  const cognition = await apiRequest(page, `/api/towns/${town.id}/residents/${keeper.id}/cognition`);
  expect(cognition.reflections).toHaveLength(1);
  expect(cognition.schedule.items).toHaveLength(2);
  expect(cognition.reflectionStatus.importanceTotal).toBe(5);
  const snapshot = await apiRequest(page, `/api/towns/${town.id}/snapshot?eventLimit=50`);
  const updatedKeeper = snapshot.residents.find((resident) => resident.id === keeper.id);
  expect(updatedKeeper.currentLocation).toBe('鹿鸣药圃');
  expect(updatedKeeper.state.currentActivity).toBe('在鹿鸣药圃比对星尘草光向');

  await page.getByRole('button', { name: '打开完整时间线' }).click();
  const timeline = page.getByRole('complementary', { name: '完整世界时间线' });
  await expect(timeline).toContainText('AI 认知');
  await expect(timeline).toContainText(`${keeper.name}完成了新的日程规划`);
  await page.screenshot({ path: path.join(os.tmpdir(), 'flai-town-cognition-desktop.png'), fullPage: false });
  await timeline.getByRole('button', { name: '关闭时间线' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const cognitionTab = page.getByRole('tab', { name: '认知' });
  await cognitionTab.scrollIntoViewIfNeeded();
  await expect(cognitionTab).toBeVisible();
  await expect(page.getByText('在鹿鸣药圃比对星尘草光向')).toBeVisible();
  const hasPageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasPageOverflow).toBe(false);
  await page.screenshot({ path: path.join(os.tmpdir(), 'flai-town-cognition-mobile.png'), fullPage: false });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

function createTownPayload(suffix) {
  return {
    name: `星落谷 QA ${suffix}`,
    description: '陨石雨后的山谷聚落，居民正在调查桥下钟声。',
    creationPrompt: `自然语言世界构想 ${suffix}：创建一座陨石雨后的山谷聚落。`,
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
      seed: 42,
      palette: {
        ground: '#74856b', groundAlt: '#50655c', water: '#527ca4', waterEdge: '#9ec3b1',
        road: '#c2a576', roadEdge: '#665c5e', wall: '#d3c6ad', roof: '#684c78', tree: '#3d6555', rock: '#747084'
      },
      terrainPatches: [],
      waterBodies: [],
      decorations: [],
      roads: [{
        id: 'road-bridge-garden',
        from: 'location-bridge',
        to: 'location-garden',
        points: [{ x: 300, y: 220 }, { x: 550, y: 300 }, { x: 800, y: 360 }]
      }],
      locations: [
        { id: 'location-bridge', name: '星痕石桥', kind: 'bridge', description: '横跨河谷的旧石桥。', x: 300, y: 220, radius: 100 },
        { id: 'location-garden', name: '鹿鸣药圃', kind: 'garden', description: '种植星尘草的药圃。', x: 800, y: 360, radius: 100 }
      ],
      buildings: [
        { id: 'building-bridge', locationId: 'location-bridge', kind: 'bridge', x: 360, y: 260, width: 48, height: 32, floors: 2 },
        { id: 'building-garden', locationId: 'location-garden', kind: 'garden', x: 860, y: 400, width: 44, height: 30, floors: 1 }
      ]
    }
  };
}

function createResident(page, townId, body) {
  return apiRequest(page, `/api/towns/${townId}/residents`, { method: 'POST', body });
}

async function seedResidentContext(page, townId, resident, fixture) {
  await apiRequest(page, `/api/towns/${townId}/residents/${resident.id}/memories`, {
    method: 'POST',
    body: {
      memoryType: 'event',
      content: fixture.memory,
      importance: 8,
      occurredTick: 570
    }
  });
  await apiRequest(page, `/api/towns/${townId}/residents/${resident.id}/schedules/1`, {
    method: 'PUT',
    body: {
      goal: resident.profile.goal,
      items: [{
        startMinute: 540,
        endMinute: 720,
        activity: fixture.activity,
        location: fixture.location,
        intention: resident.profile.goal
      }]
    }
  });
}

function sendToolCompletion(response, { id, callId, toolName, argumentsValue }) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    id,
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: callId,
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(argumentsValue)
          }
        }]
      },
      finish_reason: 'tool_calls'
    }],
    usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 }
  }));
}
