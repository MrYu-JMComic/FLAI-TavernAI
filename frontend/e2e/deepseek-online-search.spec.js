import path from 'node:path';
import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('DeepSeek online search stays independent and fits desktop and mobile chat', async ({ page }) => {
  const screenshotDirectory = path.resolve(process.cwd(), '..', '.runtime-check');
  await page.setViewportSize({ width: 1440, height: 900 });
  await registerUser(page, uniqueSuffix());
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: { name: `联网模式 ${uniqueSuffix()}`, openingMessage: '你好。' }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST',
    body: { characterId: character.id }
  });

  await page.goto(`/#/chat/${conversation.id}`);
  await expect(page.getByRole('button', { name: '添加图片' })).toBeEnabled();
  await expect(page.locator('.model-switch-name')).toBeVisible();
  await expect(page.locator('.thinking-level-copy')).toContainText('思考');
  const responseModes = page.getByRole('button', { name: '响应模式设置' });
  await expect(responseModes).toBeVisible();
  await expect(responseModes).toHaveText('');
  await expect(responseModes).toHaveAttribute('aria-expanded', 'false');
  await responseModes.click();
  const streamToggle = page.getByRole('button', { name: '流式输出' });
  const toggle = page.getByRole('button', { name: 'DeepSeek 联网搜索' });
  await expect(streamToggle).toBeVisible();
  await expect(streamToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(streamToggle).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: path.join(screenshotDirectory, 'deepseek-online-search-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '响应模式' })).toBeHidden();
  await expect(responseModes).toBeFocused();
  await page.getByRole('textbox', { name: '聊天消息输入' }).click();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 363, height: 668 },
    { width: 320, height: 700 }
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    await expect(page.locator('.deep-composer-wrap')).toBeVisible();
    await expect(responseModes).toBeVisible();
    await expect(page.getByRole('dialog', { name: '响应模式' })).toBeHidden();
    const composer = await page.locator('.deep-composer-wrap').boundingBox();
    const triggerBounds = await responseModes.boundingBox();
    const sendButton = page.getByRole('button', { name: '发送消息' });
    const sendBounds = await sendButton.boundingBox();
    const sendIconBounds = await sendButton.locator('svg').boundingBox();
    const toolbar = await page.locator('.composer-actions').evaluate((element) => {
      const selectors = ['.model-switch-pill', '.thinking-level-control', '.attachment-pill', '.response-mode-menu', '.round-send'];
      const controls = selectors.map((selector) => {
        const control = element.querySelector(selector);
        const bounds = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        return { x: bounds.x, y: bounds.y, right: bounds.right, height: bounds.height, borderWidth: style.borderTopWidth, background: style.backgroundColor };
      });
      return { controls, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    expect(composer).not.toBeNull();
    expect(triggerBounds).not.toBeNull();
    expect(sendBounds).not.toBeNull();
    expect(sendIconBounds).not.toBeNull();
    expect(Math.abs((sendBounds.x + sendBounds.width / 2) - (sendIconBounds.x + sendIconBounds.width / 2))).toBeLessThan(1);
    expect(Math.abs((sendBounds.y + sendBounds.height / 2) - (sendIconBounds.y + sendIconBounds.height / 2))).toBeLessThan(1);
    expect(triggerBounds.width).toBeGreaterThan(0);
    expect(triggerBounds.height).toBeGreaterThan(0);
    expect(Math.abs((sendBounds.y + sendBounds.height / 2) - (triggerBounds.y + triggerBounds.height / 2))).toBeLessThan(1);
    for (let index = 1; index < toolbar.controls.length; index += 1) {
      expect(toolbar.controls[index].x).toBeGreaterThan(toolbar.controls[index - 1].x);
    }
    for (const control of toolbar.controls.slice(0, 4)) {
      expect(control.height).toBeLessThanOrEqual(34);
      expect(Math.abs(control.y - toolbar.controls[0].y)).toBeLessThan(1);
    }
    expect(toolbar.controls[2].borderWidth).toBe('0px');
    expect(toolbar.controls[2].background).toBe('rgba(0, 0, 0, 0)');
    expect(toolbar.controls[3].borderWidth).toBe('0px');
    expect(toolbar.controls[3].background).toBe('rgba(0, 0, 0, 0)');
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth + 1);
    expect(composer.x).toBeGreaterThanOrEqual(0);
    expect(composer.x + composer.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(triggerBounds.x).toBeGreaterThanOrEqual(composer.x);
    expect(triggerBounds.x + triggerBounds.width).toBeLessThanOrEqual(composer.x + composer.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
    expect(await page.locator('.composer-actions').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    if (viewport.width === 363) {
      await page.screenshot({ path: path.join(screenshotDirectory, 'deepseek-online-search-mobile.png') });
    }
    await responseModes.click();
    await expect(page.getByRole('dialog', { name: '响应模式' })).toBeVisible();
    await expect(toggle).toBeVisible();
    const panelBounds = await page.getByRole('dialog', { name: '响应模式' }).boundingBox();
    expect(panelBounds).not.toBeNull();
    expect(panelBounds.x).toBeGreaterThanOrEqual(0);
    expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press('Escape');
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const sentBodies = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/conversations\/[^/]+\/messages$/.test(request.url())) {
      try { sentBodies.push(request.postDataJSON()); } catch { /* Ignore non-JSON requests. */ }
    }
  });
  await page.getByRole('textbox', { name: '聊天消息输入' }).fill('联网模式测试');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect.poll(() => sentBodies.some((body) => body.webSearch === true)).toBe(true);
});
