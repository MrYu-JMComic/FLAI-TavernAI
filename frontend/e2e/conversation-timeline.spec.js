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
  let stateStatus = 'needs_rebuild';
  const commands = [];
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
  await panel.getByRole('button', { name: '重建状态' }).click();
  await expect(panel.getByText(/重建 3 轮/)).toBeVisible();
  expect(commands.at(-1).confirmed).toBeUndefined();
  await panel.getByRole('button', { name: '确认', exact: true }).click();
  await expect(panel).toBeHidden();
  expect(commands.at(-1).confirmed).toBe(true);
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
