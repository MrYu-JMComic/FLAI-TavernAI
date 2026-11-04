import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`character memory and silent workflow at ${viewport.width}px without provider calls`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await registerUser(page);
    const character = await apiRequest(page, '/api/characters', { method: 'POST', body: { name: `阿青 ${uniqueSuffix()}`, openingMessage: '阿青在旧港与小雪相遇，交给她一把黄铜钥匙。', authorAdvancedSettings: { accessorySkills: { memoryAgent: { thinkingLevel: 'high', memoryPolicy: { shortTermTurns: 6 } } } } } });
    const conversation = await apiRequest(page, '/api/conversations', { method: 'POST', body: { characterId: character.id } });
    const base = `/api/conversations/${conversation.id}`;
    const actors = [{ id: 'actor-aqing', name: '阿青', aliases: [], castKey: 'main-character', origin: 'card', counts: { memories: 3, events: 1, relations: 1, items: 2 } }, { id: 'actor-xiaoxue', name: '小雪', aliases: ['雪儿'], castKey: '', origin: 'story', counts: { memories: 3, events: 1, relations: 1, items: 2 } }];
    const dossier = actor => ({ version: 1, revision: 8, actor, counts: actor.counts,
      memories: [{ id: 'memory-1', content: `${actor.name}答应月圆前回到灯塔。`, truthStatus: 'established' }, { id: 'memory-2', content: `${actor.name}习惯随身携带一条深蓝色围巾。`, truthStatus: 'established' }],
      events: [{ id: 'event-1', content: `${actor.name}在旧港收下黄铜钥匙，并听见三声钟响。`, truthStatus: 'established', evidenceRefs: [{ messageId: 'assistant-1', quote: '把钥匙交给你。' }] }],
      relations: [{ id: 'claim-1', subjectName: actor.name, predicate: '信任', objectName: '阿青', truthStatus: 'unverified', validFrom: 2, direction: 'outgoing' }],
      items: [{ id: 'claim-key', name: '黄铜钥匙', description: '打开旧灯塔侧门的钥匙。', quantity: null, status: 'established', authoritative: false, source: 'memory' }, { id: 'scene-lamp', name: '提灯', description: '从码头仓库取出的提灯。', quantity: 1, status: 'established', authoritative: true, source: 'scene' }] });
    let processingRequests = 0;
    let forbiddenCalls = 0;
    let mockReplies = 0;
    await page.route(`**${base}/processing`, route => { processingRequests += 1; return route.fulfill({ json: { conversationId: conversation.id, stateStatus: 'pending', coreReady: false, stages: { core: [{ id: 'background-core', status: 'running', progress: 35 }], summary: [{ id: 'summary', status: 'running' }], index: [] }, job: { id: 'background-core', status: 'running' } } }); });
    await page.route(`**${base}/processing/rebuild`, route => { forbiddenCalls += 1; return route.abort(); });
    await page.route(`**${base}/messages`, route => {
      if (route.request().method() !== 'POST') return route.continue();
      mockReplies += 1;
      const input = route.request().postDataJSON();
      const result = { userMessage: { id: 'mock-user', role: 'user', content: input.content, attachments: [], revision: 1, createdAt: new Date().toISOString() }, assistantMessage: { id: 'mock-assistant', role: 'assistant', content: '小雪提起灯，踏上通往旧灯塔的小路。', attachments: [], revision: 1, createdAt: new Date().toISOString() } };
      return input.stream === false ? route.fulfill({ json: result }) : route.fulfill({ contentType: 'text/event-stream', body: `event: content\ndata: ${JSON.stringify({ text: result.assistantMessage.content })}\n\nevent: done\ndata: ${JSON.stringify(result)}\n\n` });
    });
    await page.route(`**${base}/memory-state**`, route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/actors')) return route.fulfill({ json: { version: 1, revision: 8, actors: actors.filter(actor => !url.searchParams.get('query') || [actor.name, ...actor.aliases].join(' ').includes(url.searchParams.get('query'))) } });
      if (url.pathname.includes('/actors/')) {
        const value = dossier(actors.find(actor => url.pathname.endsWith(actor.id)));
        return route.fulfill({ json: { ...value, ...(url.searchParams.has('offset') ? { memories: [{ id: 'earlier', content: `${value.actor.name}曾在春天修好灯塔的钟。` }] } : {}), pagination: { offset: Number(url.searchParams.get('offset') || 0), limit: 200, hasMore: !url.searchParams.has('offset') } } });
      }
      return route.fulfill({ json: { revision: 8, coreReady: true, watermarks: { core: 8, summary: 7, index: 7 }, index: { enabled: false }, entities: [], events: [], claims: [], knowledge: [], threads: [], summaries: [] } });
    });
    await page.goto(`/#/chat/${conversation.id}`);
    await expect(page.locator('.deep-chat-main')).toBeVisible();
    await page.getByRole('textbox', { name: '聊天消息输入' }).fill('小雪把钥匙收好，向灯塔走去。');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    await expect(page.getByRole('region', { name: '剧情同步状态' })).toHaveCount(0);
    await expect.poll(() => processingRequests).toBeGreaterThan(1);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByText('小雪提起灯，踏上通往旧灯塔的小路。', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: '聊天消息输入' }).fill('她在门前停下，听见熟悉的钟声。');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
    await expect(page.getByRole('region', { name: '剧情同步状态' })).toHaveCount(0);
    expect(mockReplies).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`silent-chat-${viewport.width}.png`), fullPage: true, animations: 'disabled' });

    const openMemory = async () => {
      await page.getByLabel('更多聊天工具', { exact: true }).click();
      await page.getByRole('menuitem', { name: '上下文检查器' }).click();
      const inspector = page.getByRole('dialog', { name: /^(Prompt Pipeline V2|记忆工作台)$/ });
      await inspector.getByRole('tab', { name: '记忆', exact: true }).click();
      await expect(inspector.getByRole('heading', { name: '记忆工作台', exact: true })).toBeVisible();
      return inspector;
    };
    let inspector = await openMemory();
    const workspace = page.getByRole('region', { name: '角色记忆档案' });
    if (viewport.width <= 760) await workspace.getByRole('combobox', { name: '查看角色' }).selectOption('actor-xiaoxue');
    else await workspace.getByRole('button', { name: /小雪/ }).click();
    await expect(workspace.getByText('小雪答应月圆前回到灯塔。', { exact: true })).toBeVisible();
    await workspace.getByRole('button', { name: '加载更多记录', exact: true }).click();
    await expect(workspace.getByText('小雪曾在春天修好灯塔的钟。', { exact: true })).toBeVisible();
    await expect(workspace.getByRole('button', { name: '加载更多记录', exact: true })).toHaveCount(0);
    await expect(workspace.getByRole('navigation', { name: '角色档案分类' }).getByRole('button', { name: /^记忆/ })).toHaveText('记忆3');
    await expect(workspace.getByRole('list', { name: '小雪的记忆' }).getByRole('listitem')).toHaveCount(3);
    await assertFits(page, inspector);
    await page.screenshot({ path: testInfo.outputPath(`actor-memories-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    for (const [tab, text] of [['事件', '小雪在旧港收下黄铜钥匙，并听见三声钟响。'], ['关系', '信任'], ['物品', '黄铜钥匙']]) {
      await workspace.getByRole('navigation', { name: '角色档案分类' }).getByRole('button', { name: new RegExp(`^${tab}`) }).click();
      await expect(workspace.getByText(text, { exact: true })).toBeVisible();
      await assertFits(page, inspector);
      await page.screenshot({ path: testInfo.outputPath(`actor-${tab}-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    }
    await expect(workspace.getByText('剧情来源记录 · 数量未明确', { exact: true })).toBeVisible();
    await workspace.getByRole('searchbox', { name: '搜索剧情角色' }).fill('雪儿');
    await expect.poll(async () => workspace.locator('.actor-list button').count()).toBe(1);
    await inspector.getByRole('button', { name: '整理设置', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '记忆 Agent 设置', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^同步方式/).selectOption('blocking');
    await dialog.getByLabel(/^短期连续性轮数/).fill('12');
    await dialog.getByLabel(/^AI 整理时自动合并压缩/).uncheck();
    await dialog.getByLabel(/^记忆与状态栏联动/).check();
    await page.screenshot({ path: testInfo.outputPath(`workflow-settings-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    const thinking = dialog.getByLabel(/^思考等级/);
    await expect(thinking).toHaveValue('high');
    await expect(thinking.locator('option')).toHaveText(['跟随供应商配置', '关闭（off）', '极低（minimal）', '低（low）', '中（medium）', '高（high）', '很高（xhigh）', '最高（max）']);
    await thinking.selectOption('off');
    await thinking.scrollIntoViewIfNeeded();
    await assertFits(page, dialog);
    await page.screenshot({ path: testInfo.outputPath(`memory-thinking-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(dialog).toBeHidden();
    let saved = await apiRequest(page, `${base}/accessory-skills`);
    expect(saved.skills.memoryAgent.memoryPolicy).toMatchObject({ syncMode: 'blocking', shortTermTurns: 12, autoConsolidate: false, statusLink: true });
    expect(saved.skills.memoryAgent.thinkingLevel).toBe('off');
    await page.reload();
    inspector = await openMemory();
    await inspector.getByRole('button', { name: '整理设置', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '记忆 Agent 设置', exact: true });
    await expect(dialog.getByLabel(/^同步方式/)).toHaveValue('blocking');
    await expect(dialog.getByLabel(/^短期连续性轮数/)).toHaveValue('12');
    await expect(dialog.getByLabel(/^AI 整理时自动合并压缩/)).not.toBeChecked();
    await expect(dialog.getByLabel(/^记忆与状态栏联动/)).toBeChecked();
    await expect(dialog.getByLabel(/^思考等级/)).toHaveValue('off');
    await dialog.getByRole('button', { name: '恢复角色默认', exact: true }).click();
    await expect(dialog).toBeHidden();
    saved = await apiRequest(page, `${base}/accessory-skills`);
    expect(saved.skills.memoryAgent.memoryPolicy).toMatchObject({ syncMode: 'background', shortTermTurns: 6, autoConsolidate: true, statusLink: false });
    expect(saved.skills.memoryAgent.thinkingLevel).toBe('high');
    inspector = await openMemory();
    await inspector.getByRole('button', { name: '整理设置', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '记忆 Agent 设置', exact: true });
    await expect(dialog.getByLabel(/^思考等级/)).toHaveValue('high');
    await dialog.getByLabel(/^思考等级/).selectOption('');
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(dialog).toBeHidden();
    saved = await apiRequest(page, `${base}/accessory-skills`);
    expect(saved.skills.memoryAgent.thinkingLevel).toBe('');
    expect(forbiddenCalls).toBe(0);
  });
}

async function assertFits(page, panel) {
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}
