import { expect, test } from '@playwright/test';
import { registerUser, uniqueSuffix } from './helpers.js';

test('AI draft workspace stays inline and usable across desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await registerUser(page, uniqueSuffix());

  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await expect(page.getByRole('heading', { name: /创建新的 AI 角色/ })).toBeVisible();
  await page.getByRole('button', { name: /完整表单/ }).click();
  // The full form keeps every section available; focus the AI section in the directory.
  await page.locator('.character-studio-nav').getByRole('button', { name: /AI 完善/ }).click();

  const panel = page.locator('.ai-draft-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.ai-workbench-header')).toBeVisible();
  await expect(panel.locator('.ai-workbench-config')).toBeVisible();
  await expect(panel.locator('.ai-panel-heading, .ai-panel-resize-handle')).toHaveCount(0);

  const desktopLayout = await panel.evaluate((element) => ({
    parentClass: element.parentElement?.className || '',
    position: getComputedStyle(element).position,
    overflow: element.scrollWidth - element.clientWidth,
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth
  }));
  expect(desktopLayout.parentClass).toContain('character-studio-stage');
  expect(desktopLayout.position).toBe('relative');
  expect(desktopLayout.overflow).toBeLessThanOrEqual(1);
  expect(desktopLayout.documentOverflow).toBeLessThanOrEqual(0);

  // On phones the same panel is rendered by the mobile shell's section sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.character-mobile-section-item[data-section-id="ai"]').click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCount(1);
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
