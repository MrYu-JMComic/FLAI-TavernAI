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
  expect(desktopBox).not.toBeNull();
  expect(desktopBox.x).toBeGreaterThanOrEqual(0);
  expect(desktopBox.x + desktopBox.width).toBeLessThanOrEqual(1441);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1441);
});
