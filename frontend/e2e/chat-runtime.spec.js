import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix, waitForThemeTransition as waitForLayoutTransitions } from './helpers.js';

async function createChat(page) {
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Runtime ${uniqueSuffix()}` }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST', body: { characterId: character.id }
  });
  return { character, conversation };
}

test('long history restores before auxiliary requests and preserves reading position', async ({ page }, testInfo) => {
  await registerUser(page);
  const { conversation } = await createChat(page);
  const payload = await apiRequest(page, `/api/conversations/${conversation.id}/messages`);
  const messages = Array.from({ length: 160 }, (_, index) => ({
    id: `history-${index}`, role: index % 2 ? 'assistant' : 'user', reasoning: '',
    content: `Record ${index}\n\n${'A longer paragraph with **rendered text** and a reading anchor. '.repeat(8)}`,
    createdAt: new Date(1700000000000 + index * 1000).toISOString()
  }));
  await page.route(`**/api/conversations/${conversation.id}/messages`, (route) => (
    route.fulfill({ json: { ...payload, messages } })
  ));
  await page.route('**/api/messages/history-*/swipes', (route) => route.fulfill({ json: [] }));
  let releaseBranches;
  const branchesReady = new Promise((resolve) => { releaseBranches = resolve; });
  await page.route(`**/api/conversations/${conversation.id}/branches`, async (route) => {
    await branchesReady;
    await route.fulfill({ json: [] });
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`/#/chat/${conversation.id}`);
    const scroller = page.locator('.deep-message-scroll');
    await expect(page.locator('.deep-message[data-message-id="history-159"]')).toBeVisible();
    expect(await page.locator('.deep-message').count()).toBeLessThan(50);
    releaseBranches();
    const closeSidebar = page.getByRole('button', { name: '收起侧边栏' });
    if (await closeSidebar.isVisible()) await closeSidebar.click();
    await waitForLayoutTransitions(page);

    await scroller.hover();
    const wheelStartedAt = await page.evaluate(() => Date.now());
    const initialTop = await scroller.evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, -1800);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(initialTop - 1000);
    const storageKey = `flai-chat-scroll:${conversation.id}`;
    await expect.poll(() => page.evaluate(({ key, since }) => {
      const snapshot = JSON.parse(localStorage.getItem(key) || 'null');
      const root = document.querySelector('.deep-message-scroll');
      const top = root.getBoundingClientRect().top + parseFloat(getComputedStyle(root).paddingTop);
      const anchor = [...root.querySelectorAll('.deep-message')].find((element) => element.getBoundingClientRect().bottom > top);
      return Boolean(snapshot?.pinned === false && snapshot.savedAt >= since
        && snapshot.anchorMessageId === anchor?.dataset.messageId
        && Math.abs(anchor.getBoundingClientRect().top - top - snapshot.anchorOffset) <= 2);
    }, { key: storageKey, since: wheelStartedAt })).toBe(true);
    const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
    await page.reload();
    const anchor = page.locator(`.deep-message[data-message-id="${before.anchorMessageId}"]`);
    await expect(anchor).toBeAttached();
    await expect.poll(() => anchor.evaluate((element, expectedOffset) => {
      const root = element.closest('.deep-message-scroll');
      const top = root.getBoundingClientRect().top + parseFloat(getComputedStyle(root).paddingTop);
      return Math.abs(element.getBoundingClientRect().top - top - expectedOffset);
    }, before.anchorOffset)).toBeLessThan(4);
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').pinned, storageKey)).toBe(false);

    for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      if (await closeSidebar.isVisible()) await closeSidebar.click();
      await expect.poll(async () => {
        const composer = await page.locator('.deep-composer-wrap').boundingBox();
        const history = await scroller.boundingBox();
        const bottomInset = viewport.width <= 520
          ? await scroller.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom)) : 0;
        return composer && history && composer.y + composer.height <= viewport.height + 1
          && history.y + history.height - bottomInset <= composer.y + 1;
      }).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      await page.screenshot({ path: testInfo.outputPath(`chat-runtime-${viewport.width}.png`), animations: 'disabled' });
    }
    expect(errors).toEqual([]);
  } finally {
    releaseBranches();
  }
});

test('chat drafts survive immediate navigation and reload without crossing conversations', async ({ page }) => {
  await registerUser(page);
  const { conversation: first, character } = await createChat(page);
  const second = await apiRequest(page, '/api/conversations', {
    method: 'POST', body: { characterId: character.id }
  });
  await page.goto(`/#/chat/${first.id}`);
  const input = page.locator('.deep-composer textarea');
  await input.fill('Draft for the first conversation');
  await page.goto(`/#/chat/${second.id}`);
  await expect(input).toHaveValue('');
  await input.fill('Draft for the second conversation');
  await page.goto(`/#/chat/${first.id}`);
  await expect(input).toHaveValue('Draft for the first conversation');
  await input.fill('Most recent keystroke');
  await page.reload();
  await expect(input).toHaveValue('Most recent keystroke');
  await input.fill('');
  await page.reload();
  await expect(input).toHaveValue('');
});

test('initial message load failure exposes retry and locks generation', async ({ page }) => {
  await registerUser(page);
  const { conversation } = await createChat(page);
  let failLoad = true;
  await page.route(`**/api/conversations/${conversation.id}/messages`, (route) => (
    failLoad ? route.fulfill({ status: 500, json: { error: 'Temporary history failure' } }) : route.continue()
  ));
  await page.goto(`/#/chat/${conversation.id}`);
  await expect(page.getByRole('heading', { name: '对话加载失败' })).toBeVisible();
  await page.locator('.deep-composer textarea').fill('Retain the draft while loading');
  await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled();
  failLoad = false;
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByRole('heading', { name: '对话加载失败' })).toBeHidden();
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
});

test('draft cache denial remains visible on a phone without blocking input', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerUser(page);
  const { conversation } = await createChat(page);
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'flai-chat-drafts:v1') throw new DOMException('Storage unavailable', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto(`/#/chat/${conversation.id}`);
  await page.reload();
  const input = page.locator('.deep-composer textarea');
  await input.fill('Keep this draft visible');
  await expect(page.locator('.chat-draft-status')).toBeVisible();
  await expect(input).toHaveValue('Keep this draft visible');
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  const composer = await page.locator('.deep-composer-wrap').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(813);
});
