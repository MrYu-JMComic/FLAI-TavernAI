import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

async function createCharacterAndOpenChat(page, name) {
  const character = await apiRequest(page, '/api/characters', { method: 'POST', body: { name } });
  const conversation = await apiRequest(page, '/api/conversations', { method: 'POST', body: { characterId: character.id } });
  await page.goto(`/#/chat/${conversation.id}`);
  await expect(page.locator('.deep-chat-main')).toBeVisible();
}

test('chat state recovery is visible and a user can confirm or accept a historical rebuild', async ({ page }, testInfo) => {
  await registerUser(page);
  await createCharacterAndOpenChat(page, `Timeline ${uniqueSuffix()}`);
  const match = /conversations\/([^/?#]+)/.exec(page.url());
  const conversationId = match?.[1] || /chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(conversationId).toBeTruthy();
  const base = `/api/conversations/${conversationId}`;
  let stateStatus = 'needs_rebuild';
  const commands = [];
  const unexpectedMutations = [];
  const reads = { status: 0, economy: 0, messages: 0, processing: 0 };
  page.on('request', request => {
    if (request.method() !== 'GET') return;
    const pathname = new URL(request.url()).pathname;
    if (pathname === `${base}/status-bar`) reads.status += 1;
    if (pathname === `${base}/economy`) reads.economy += 1;
    if (pathname === `${base}/messages`) reads.messages += 1;
    if (pathname === `${base}/processing`) reads.processing += 1;
  });
  // Recovery is exercised entirely against local fixtures; no new workspace read can start real processing.
  await page.route(`**${base}/memory-state**`, route => {
    if (route.request().method() !== 'GET') { unexpectedMutations.push(route.request().url()); return route.abort(); }
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({ json: pathname.endsWith('/actors') ? { version: 1, revision: 2, actors: [] }
      : { revision: 2, coreReady: stateStatus === 'ready', watermarks: { core: 0, summary: 0, index: 0 }, entities: [], events: [], claims: [], knowledge: [], threads: [], summaries: [], index: { enabled: false } } });
  });
  await page.route(`**${base}/memories**`, route => {
    if (route.request().method() !== 'GET') { unexpectedMutations.push(route.request().url()); return route.abort(); }
    return route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/conflicts') ? { candidates: [] }
      : { memories: stateStatus === 'ready' ? [{ id: 'recovered', revision: 1, memoryType: 'event', content: '恢复后已同步的剧情', enabled: true }] : [] } });
  });
  await page.route(`**${base}/context/preview`, route => route.fulfill({ json: { messages: [], contextBundle: { source: { coreOrder: 0 }, memory: { entries: [] } } } }));
  await page.route(`**/api/conversations/${conversationId}/processing`, (route) => route.fulfill({ json: {
    conversationId, stateStatus, timelineRevision: 2, job: null
  } }));
  await page.route(`**/api/conversations/${conversationId}/processing/rebuild`, (route) => {
    const body = route.request().postDataJSON();
    commands.push(body);
    if (body.confirmed) stateStatus = 'ready';
    return route.fulfill({ json: body.confirmed ? { stateStatus: 'ready', jobs: [] } : { turnCount: 3, confirmationRequired: true } });
  });
  await page.reload();
  const panel = page.getByRole('region', { name: '剧情同步状态' });
  await expect(panel).toBeVisible();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const closeSidebar = page.getByRole('button', { name: '收起侧边栏' });
    if (await closeSidebar.isVisible()) await closeSidebar.click();
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const panelBox = await panel.boundingBox();
    expect(panelBox.height).toBeLessThan(viewport.width < 600 ? 116 : 76);
    const messageBox = await page.locator('.deep-message-scroll').boundingBox();
    expect(messageBox.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height - 1);
    if (viewport.height < 500) {
      const empty = await page.locator('.chat-empty-conversation').boundingBox();
      const composer = await page.locator('.deep-composer').boundingBox();
      expect(empty.y + empty.height).toBeLessThanOrEqual(composer.y);
    }
    await page.screenshot({ path: testInfo.outputPath(`timeline-${viewport.width}.png`), animations: 'disabled' });
  }
  const draft = '恢复期间保留的草稿';
  await page.getByLabel('聊天消息输入').fill(draft);
  const beforeRecovery = { ...reads };
  await panel.getByRole('button', { name: '查看记忆', exact: true }).click();
  const inspector = page.getByRole('dialog', { name: '记忆工作台', exact: true });
  await inspector.getByText('同步与恢复', { exact: true }).click();
  const recovery = inspector.getByRole('region', { name: '剧情同步状态' });
  await recovery.getByRole('button', { name: '重建状态', exact: true }).click();
  const confirmation = recovery.getByRole('group', { name: '确认剧情状态操作' });
  await expect(confirmation).toContainText('重建 3 轮剧情状态');
  await expect(confirmation).toContainText('可能产生模型调用费用');
  expect(commands.at(-1).confirmed).toBeUndefined();
  expect(commands).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath('timeline-rebuild-confirm.png'), animations: 'disabled' });
  await confirmation.getByRole('button', { name: '确认', exact: true }).click();
  await expect(recovery).toBeHidden();
  await expect(panel).toBeHidden();
  expect(commands.at(-1)).toMatchObject({ confirmed: true, acceptCurrent: false, expectedTurnCount: 3 });
  expect(commands).toHaveLength(2);
  await expect.poll(() => reads.status).toBeGreaterThan(beforeRecovery.status);
  await expect.poll(() => reads.economy).toBeGreaterThan(beforeRecovery.economy);
  await inspector.getByRole('button', { name: '全部记忆', exact: true }).click();
  await expect(inspector.getByText('恢复后已同步的剧情', { exact: true })).toBeVisible();
  expect(reads.messages).toBe(beforeRecovery.messages);
  expect(reads.processing - beforeRecovery.processing).toBeLessThan(12);
  await inspector.getByRole('button', { name: '关闭上下文检查器', exact: true }).click();
  await expect(page.getByLabel('聊天消息输入')).toHaveValue(draft);
  await page.screenshot({ path: testInfo.outputPath('timeline-recovered.png'), animations: 'disabled' });
  expect(unexpectedMutations).toEqual([]);
});


test('chat omits removed management tools and restores independent scene items', async ({ page }) => {
  await registerUser(page);
  await createCharacterAndOpenChat(page, 'Scene snapshot ' + uniqueSuffix());
  const conversationId = /chat\/([^/?#]+)/.exec(page.url())?.[1];
  const base = '/api/conversations/' + conversationId;
  await expect(page.getByRole('button', { name: 'NPC 管理', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '多角色模式', exact: true })).toHaveCount(0);
  const node = await apiRequest(page, base + '/scenes/nodes', { method: 'POST', body: { name: 'Snapshot harbor', nodeType: 'main_scene' } });
  const item = await apiRequest(page, base + '/scenes/items', { method: 'POST', body: { nodeId: node.id, name: 'Snapshot key', itemCode: 'SNAPSHOT-KEY' } });
  const save = await apiRequest(page, base + '/saves', { method: 'POST', body: { name: 'Before change' } });
  await apiRequest(page, base + '/scenes/items/' + item.id, { method: 'PUT', body: { quantity: 2, revision: item.revision } });
  await apiRequest(page, '/api/saves/' + save.id + '/load', { method: 'POST', body: { conversationId } });
  const restored = await apiRequest(page, base + '/scenes');
  expect(restored.items.find(entry => entry.id === item.id).quantity).toBe(1);
});
