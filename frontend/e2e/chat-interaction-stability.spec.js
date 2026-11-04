import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('mobile chat viewport listeners stay active while auxiliary conversation data is pending', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = window.visualViewport;
    let simulatedHeight = viewport.height;
    const simulatedViewport = new Proxy(viewport, {
      get(target, property) {
        if (property === 'height') return simulatedHeight;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: simulatedViewport });
    window.__setChatVisualViewportHeight = (height) => {
      simulatedHeight = height;
      simulatedViewport.dispatchEvent(new Event('resize'));
    };
  });
  await registerUser(page, uniqueSuffix());

  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: { name: `Viewport ${uniqueSuffix()}` }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST',
    body: { characterId: character.id }
  });

  let signalBranchesRequested;
  const branchesRequested = new Promise((resolve) => { signalBranchesRequested = resolve; });
  let releaseBranches;
  const branchesGate = new Promise((resolve) => { releaseBranches = resolve; });
  await page.route(`**/api/conversations/${conversation.id}/branches`, async (route) => {
    signalBranchesRequested();
    await branchesGate;
    await route.continue();
  });

  await page.goto(`/#/chat/${conversation.id}`);
  try {
    await branchesRequested;
    const composer = page.getByLabel('聊天消息输入');
    await expect(composer).toBeEnabled();
    await composer.focus();
    await page.evaluate(() => window.__setChatVisualViewportHeight(430));
    await expect(page.locator('.deep-chat-shell')).toHaveCSS('--chat-visual-viewport-height', '430px');
    await expect(page.locator('.deep-chat-shell')).toHaveCSS('--chat-keyboard-inset', '414px');
    await page.screenshot({ path: testInfo.outputPath('chat-keyboard-docked-while-branches-pending-390.png'), animations: 'disabled' });
  } finally {
    releaseBranches();
  }
});

test('Escape closes the response mode menu without closing the desktop sidebar', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerUser(page, uniqueSuffix());
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: { name: `Escape ${uniqueSuffix()}` }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST',
    body: { characterId: character.id }
  });

  await page.goto(`/#/chat/${conversation.id}`);
  const shell = page.locator('.deep-chat-shell');
  await expect(shell).not.toHaveClass(/sidebar-collapsed/);
  await page.getByRole('button', { name: '响应模式设置' }).click();
  await expect(page.getByRole('dialog', { name: '响应模式' })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog', { name: '响应模式' })).toHaveCount(0);
  await expect(shell).not.toHaveClass(/sidebar-collapsed/);
  await page.screenshot({ path: testInfo.outputPath('chat-response-menu-escape-keeps-sidebar-1280.png'), animations: 'disabled' });
});
