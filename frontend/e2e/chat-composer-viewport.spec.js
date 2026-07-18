import { expect, test } from '@playwright/test';
import { registerUser, uniqueSuffix } from './helpers.js';

test('mobile chat composer stays inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerUser(page, uniqueSuffix());

  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await page.getByRole('button', { name: /完整表单/ }).click();
  await page.getByLabel('角色名').fill(`移动端角色 ${uniqueSuffix()}`);
  await page.getByRole('button', { name: /保存角色/ }).click();
  await expect(page).toHaveURL(/#\/characters\/[^/]+\/edit/, { timeout: 15_000 });

  await page.getByRole('button', { name: /^返回$/ }).click();
  const characterCard = page.locator('.home-character-card').first();
  await expect(characterCard).toBeVisible();
  await characterCard.getByRole('button', { name: /对话/ }).click();
  await expect(page).toHaveURL(/#\/chat\/[^/]+/, { timeout: 15_000 });

  const composer = page.locator('.deep-composer-wrap');
  await expect(composer).toBeVisible();
  const viewport = page.viewportSize();
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(120);
  const desktopBox = await composer.boundingBox();
  const messageScroller = page.locator('.deep-message-scroll');
  const messageScrollerBox = await messageScroller.boundingBox();
  const assistantContent = page.locator('.deep-message.assistant .deep-message-content');
  const assistantContentCount = await assistantContent.count();
  const assistantContentBox = assistantContentCount === 1
    ? await assistantContent.boundingBox()
    : null;
  expect(desktopBox).not.toBeNull();
  expect(messageScrollerBox).not.toBeNull();
  expect(desktopBox.x).toBeGreaterThanOrEqual(0);
  expect(desktopBox.x + desktopBox.width).toBeLessThanOrEqual(1441);
  if (assistantContentBox) {
    expect(desktopBox.width).toBeGreaterThan(assistantContentBox.width + 40);
  }
  expect(messageScrollerBox.y + messageScrollerBox.height).toBeLessThanOrEqual(desktopBox.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1441);

  const scrollProbe = await messageScroller.evaluate((element) => {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.flex = `0 0 ${Math.max(1200, element.clientHeight * 2)}px`;
    element.appendChild(probe);
    element.scrollTop = element.scrollHeight;
    const result = {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop
    };
    probe.remove();
    return result;
  });
  expect(scrollProbe.clientHeight).toBeGreaterThan(0);
  expect(scrollProbe.scrollHeight).toBeGreaterThan(scrollProbe.clientHeight);
  expect(scrollProbe.scrollTop).toBeGreaterThan(0);

  await page.getByRole('button', { name: '打开侧边栏' }).click();
  await expect(page.locator('.deep-chat-shell')).not.toHaveClass(/sidebar-collapsed/);

  const expandedComposerBox = await composer.boundingBox();
  const expandedMessageScrollerBox = await messageScroller.boundingBox();
  const expandedSidebarBox = await page.locator('.deep-sidebar').boundingBox();
  expect(expandedComposerBox).not.toBeNull();
  expect(expandedMessageScrollerBox).not.toBeNull();
  expect(expandedSidebarBox).not.toBeNull();
  expect(expandedComposerBox.y + expandedComposerBox.height).toBeLessThanOrEqual(901);
  if (assistantContentBox) {
    expect(expandedComposerBox.width).toBeGreaterThan(assistantContentBox.width + 40);
  }
  expect(expandedMessageScrollerBox.y + expandedMessageScrollerBox.height).toBeLessThanOrEqual(expandedComposerBox.y + 1);
  expect(expandedSidebarBox.y + expandedSidebarBox.height).toBeLessThanOrEqual(901);
});
