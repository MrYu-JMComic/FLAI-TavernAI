import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`memory V1 review and settings remain usable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await registerUser(page);
    const character = await apiRequest(page, '/api/characters', { method: 'POST', body: { name: `阿青 ${uniqueSuffix()}`, openingMessage: '旧港的钟声响了，小雪握着那把黄铜钥匙。' } });
    const conversation = await apiRequest(page, '/api/conversations', { method: 'POST', body: { characterId: character.id } });
    const core = { id: 'core-1', status: 'succeeded', progress: 100 };
    const state = {
      revision: 8, coreReady: true, requiredStages: ['core'], watermarks: { core: 8, summary: 6, index: 5 },
      stages: { core, summary: { id: 'summary-1', status: 'running' }, index: { id: 'index-1', status: 'failed' } },
      index: { enabled: true },
      entities: [{ id: 'actor-aqing', name: '阿青', kind: 'actor', castKey: 'captain-aqing' }, { id: 'actor-xiaoxue', name: '小雪', kind: 'actor', castKey: 'xiaoxue' }],
      events: [{ id: 'event-1', kind: 'transfer', content: '阿青把黄铜钥匙交给小雪。', lifecycle: 'active', evidenceRefs: [{ messageId: 'assistant-8', revision: 1, quote: '钥匙交给你。' }] }],
      claims: [{ id: 'claim-1', content: '小雪持有黄铜钥匙。', truthStatus: 'established' }],
      knowledge: [{ id: 'knowledge-1', actorId: 'actor-xiaoxue', eventId: 'event-1', epistemicState: 'experienced' }],
      threads: [{ id: 'thread-1', kind: 'promise', content: '月圆前一起返回灯塔。', status: 'open' }],
      summaries: [{ id: 'summary-1', level: 'scene', content: '阿青与小雪在旧港重逢，交接钥匙后约定返回灯塔。' }]
    };
    await page.route(`**/api/conversations/${conversation.id}/memory-state**`, (route) => route.fulfill({ json: state }));
    await page.route(`**/api/conversations/${conversation.id}/processing`, (route) => route.fulfill({ json: { ...state, job: core, stateStatus: 'ready' } }));
    await page.route(`**/api/conversations/${conversation.id}/context/preview`, (route) => route.fulfill({ json: {
      contextBundle: { source: { coreOrder: 8 }, actorId: 'actor-xiaoxue', memory: { entries: [] } },
      retrieval: { evidence: [{ id: 'memory-1', eventId: 'event-1', content: '阿青把黄铜钥匙交给小雪。', reasons: ['entity_graph', 'vector'], sourceHash: 'ae'.repeat(32), epistemicState: 'experienced' }] }
    } }));
    await page.route(`**/api/conversations/${conversation.id}/memories`, (route) => route.fulfill({ json: { memories: [{ id: 'memory-1', revision: 1, memoryType: 'event', subject: '黄铜钥匙', content: '阿青把黄铜钥匙交给小雪。', lifecycle: 'active', enabled: true, sourceExcerpt: '“钥匙交给你。”阿青说。', confidence: 1 }] } }));
    await page.goto(`/#/chat/${conversation.id}`);
    await expect(page.locator('.deep-chat-main')).toBeVisible();
    await page.getByLabel('更多聊天工具', { exact: true }).click();
    await page.getByRole('menuitem', { name: '上下文检查器' }).click();
    const inspector = page.getByRole('dialog', { name: /^(Prompt Pipeline V2|记忆工作台)$/ });
    await expect(inspector.getByText('记忆来源与召回', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`memory-recall-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    expect(await inspector.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await inspector.getByRole('tab', { name: '记忆', exact: true }).click();
    await inspector.getByText('同步与恢复', { exact: true }).click();
    await expect(inspector.getByText('核心记忆已就绪', { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: '全部记忆', exact: true }).click();
    await inspector.getByRole('button', { name: '角色认知', exact: true }).click();
    await expect(inspector.getByText('亲历', { exact: true })).toBeVisible();
    await inspector.getByText('角色标识与来源范围', { exact: true }).click();
    await expect(inspector.getByText('actor-aqing', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`memory-actors-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    expect(await inspector.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await inspector.getByRole('button', { name: '记忆审阅', exact: true }).click();
    await inspector.getByLabel('编辑记忆', { exact: true }).click();
    const memoryEditor = page.getByRole('dialog', { name: '记忆编辑', exact: true });
    await expect(memoryEditor).toBeVisible();
    await memoryEditor.getByRole('combobox', { name: '知情范围', exact: true }).selectOption('restricted');
    await memoryEditor.getByLabel(/^知情角色/).selectOption('actor-xiaoxue');
    await page.screenshot({ path: testInfo.outputPath(`memory-edit-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    expect(await memoryEditor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await memoryEditor.getByRole('button', { name: '取消', exact: true }).click();
    await inspector.getByRole('button', { name: '结构化修订', exact: true }).click();
    const packetEditor = page.getByRole('dialog', { name: '结构化记忆修订', exact: true });
    await expect(packetEditor.getByLabel('修订 JSON', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`memory-packet-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    expect(await packetEditor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await packetEditor.getByRole('button', { name: '取消', exact: true }).click();
    await inspector.getByLabel('关闭上下文检查器', { exact: true }).click();
    await page.getByLabel('更多聊天工具', { exact: true }).click();
    await page.getByRole('menuitem', { name: '会话设置' }).click();
    const drawer = page.getByLabel('高阶设置', { exact: true });
    await drawer.getByRole('button', { name: /附属技能/ }).click();
    await drawer.getByLabel('打开记忆 Agent设置', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '记忆 Agent 设置', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('关闭（不提取结构化记忆）', { exact: true })).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath(`memory-settings-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    await dialog.getByLabel('启用云端向量检索', { exact: true }).check();
    await dialog.getByLabel(/^向量维度/).selectOption('512');
    await dialog.getByLabel(/^配额换算：1 元人民币折合美元/).fill('0.14');
    await dialog.getByLabel(/^向量维度/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`memory-embedding-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toBeHidden();

    const book = await apiRequest(page, '/api/world-books', { method: 'POST', body: { name: '旧港设定' } });
    const entry = await apiRequest(page, `/api/world-books/${book.id}/entries`, { method: 'POST', body: { name: '灯塔暗号', triggerKeys: '灯塔', content: '灯塔守望者使用三声钟响作为暗号。' } });
    await page.goto(`/#/world-books/${book.id}`);
    await page.getByLabel(`编辑条目：${entry.name}`, { exact: true }).click();
    const loreDialog = page.getByRole('dialog', { name: '编辑条目', exact: true });
    await expect(loreDialog).toBeVisible();
    await loreDialog.getByRole('combobox', { name: '知情范围', exact: true }).selectOption('restricted');
    await loreDialog.getByLabel(/^角色标识/).fill('captain-aqing, xiaoxue');
    await loreDialog.getByLabel(/^角色标识/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`lore-knowledge-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    expect(await loreDialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await loreDialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(loreDialog).toBeHidden();
    const saved = await apiRequest(page, `/api/world-books/${book.id}`);
    expect(saved.entries[0].knowledgeVisibility).toBe('restricted');
    expect(saved.entries[0].audienceCastKeys).toEqual(['captain-aqing', 'xiaoxue']);
  });
}
