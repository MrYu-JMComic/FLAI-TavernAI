import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('chat focus, Markdown emphasis, and message hover render cleanly', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerUser(page, uniqueSuffix());

  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: { name: `Render ${uniqueSuffix()}` }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST',
    body: { characterId: character.id }
  });
  const payload = await apiRequest(page, `/api/conversations/${conversation.id}/messages`);
  await page.route(`**/api/conversations/${conversation.id}/messages`, (route) => route.fulfill({
    json: {
      ...payload,
      messages: [{
        id: 'render-regression-message',
        role: 'assistant',
        reasoning: '',
        content: '普通文字与 **需要清楚加粗的重点**。',
        createdAt: new Date().toISOString()
      }]
    }
  }));
  await page.route('**/api/messages/render-regression-message/swipes', (route) => route.fulfill({ json: [] }));

  await page.goto(`/#/chat/${conversation.id}`);
  const main = page.locator('.deep-chat-main');
  await main.evaluate((element) => {
    const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#476d66"/><path d="M0 260 160 120l120 110L390 45l90 100v175H0Z" fill="#c58b5a"/></svg>');
    element.style.backgroundImage = `url("data:image/svg+xml,${svg}")`;
    element.style.backgroundSize = 'cover';
  });
  await page.getByRole('button', { name: '切换到夜间模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: /快速切换聊天模型/ }).click();
  const modelSearch = page.getByRole('searchbox', { name: '搜索当前网关模型' });
  await expect(modelSearch).toBeFocused();
  const focusStyles = await page.locator('.chat-model-search').evaluate((element) => ({
    borderColor: getComputedStyle(element).borderColor,
    boxShadow: getComputedStyle(element).boxShadow,
    inputBoxShadow: getComputedStyle(element.querySelector('input')).boxShadow
  }));
  expect(focusStyles.boxShadow).toContain('0px 0px 0px 4px');
  expect(focusStyles.boxShadow).toContain('inset');
  expect(focusStyles.inputBoxShadow).toBe('none');
  expect(focusStyles.borderColor).not.toBe('rgb(0, 0, 0)');
  await page.screenshot({ path: testInfo.outputPath('chat-model-focus-dark-1280.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');

  const bubble = page.locator('.deep-message.assistant .deep-bubble').first();
  const strong = bubble.locator('.markdown-content strong').first();
  await expect(strong).toHaveText('需要清楚加粗的重点');
  await expect.poll(() => strong.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('600');
  const textWeights = await strong.evaluate((element) => ({
    strong: Number(getComputedStyle(element).fontWeight),
    paragraph: Number(getComputedStyle(element.closest('p')).fontWeight)
  }));
  expect(textWeights.strong).toBeGreaterThan(textWeights.paragraph + 100);
  await expect.poll(() => bubble.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe('none');

  const actions = page.locator('.deep-message.assistant .message-actions').first();
  await page.locator('.deep-message.assistant .message-action-button[title="复制消息"]').first().hover();
  await expect.poll(() => actions.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  await page.screenshot({ path: testInfo.outputPath('chat-hover-rendering-dark-1280.png'), animations: 'disabled' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.deep-chat-shell')).toHaveClass(/sidebar-collapsed/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.getByRole('button', { name: /快速切换聊天模型/ }).click();
  await modelSearch.click();
  await expect(modelSearch).toBeFocused();
  const mobileFocusBox = await page.locator('.chat-model-search').boundingBox();
  expect(mobileFocusBox).not.toBeNull();
  expect(mobileFocusBox.x).toBeGreaterThanOrEqual(0);
  expect(mobileFocusBox.x + mobileFocusBox.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: testInfo.outputPath('chat-model-focus-dark-390.png'), animations: 'disabled' });
});
