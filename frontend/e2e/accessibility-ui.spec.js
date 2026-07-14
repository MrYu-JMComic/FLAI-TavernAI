import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { registerUser } from './helpers.js';

async function expectNoSeriousAccessibilityViolations(page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blockingViolations = result.violations.filter((violation) => (
    violation.impact === 'critical' || violation.impact === 'serious'
  ));
  expect(blockingViolations, JSON.stringify(blockingViolations, null, 2)).toEqual([]);
}

test('authentication shell meets the critical WCAG checks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: /登录 FLAI Tavern AI/ })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test('authenticated workbench meets the critical WCAG checks on desktop and mobile', async ({ page }) => {
  await registerUser(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectNoSeriousAccessibilityViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '移动端主导航' })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});
