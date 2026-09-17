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

test('full conversation save and restore keeps cast memory and item ownership in the browser workflow', async ({ page }) => {
  await registerUser(page);
  await createCharacterAndOpenChat(page, `Snapshot ${uniqueSuffix()}`);
  const conversationId = /chat\/([^/?#]+)/.exec(page.url())?.[1] || /conversations\/([^/?#]+)/.exec(page.url())?.[1];
  const base = `/api/conversations/${conversationId}`;
  const member = await apiRequest(page, `${base}/cast`, { method: 'POST', body: { canonicalName: 'Snapshot Mira' } });
  await apiRequest(page, `${base}/cast/${member.id}/memories`, { method: 'POST', body: { content: 'Mira knows the old gate.' } });
  const save = await apiRequest(page, `${base}/saves`, { method: 'POST', body: { name: 'Before departure' } });
  await apiRequest(page, `${base}/cast/${member.id}`, { method: 'PATCH', body: { currentLocationLabel: 'Future location', revision: member.revision } });
  const result = await apiRequest(page, `/api/saves/${save.id}/load`, { method: 'POST', body: { conversationId } });
  expect(result.snapshotVersion).toBe(2);
  const memories = await apiRequest(page, `${base}/cast/${member.id}/memories`);
  expect(memories.items.some((memory) => memory.content === 'Mira knows the old gate.')).toBe(true);
});
