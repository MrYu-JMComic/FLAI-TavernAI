import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix, waitForThemeTransition } from './helpers.js';

const screenshotDir = path.resolve(process.cwd(), '..', '.runtime-check', 'mobile-character-accessory-test', 'footer-positioning');
fs.mkdirSync(screenshotDir, { recursive: true });

// Keep visual artifacts in a task-specific folder instead of the shared Playwright output directory.
function captureScreenshot(page, filename) {
  return page.screenshot({ path: path.join(screenshotDir, filename) });
}

async function measureAccessoryRows(page) {
  return page.locator('#section-accessories').evaluate((section) => ({
    viewportWidth: window.innerWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rows: [...section.querySelectorAll('.accessory-skill-row')].map((row) => ({
      bounds: row.getBoundingClientRect().toJSON(),
      fields: [...row.children].map((field) => field.getBoundingClientRect().toJSON())
    }))
  }));
}

async function measureMobileActionbar(page) {
  return page.locator('.character-mobile-actionbar').evaluate((bar) => {
    const form = bar.closest('.character-mobile-form');
    const bounds = bar.getBoundingClientRect();
    const safeAreaOffset = Number.parseFloat(getComputedStyle(bar).bottom) || 0;
    return {
      position: getComputedStyle(bar).position,
      bottomGap: window.innerHeight - bounds.bottom,
      viewportHeight: window.innerHeight,
      bottomInset: safeAreaOffset,
      formPaddingBottom: Number.parseFloat(getComputedStyle(form).paddingBottom) || 0,
      pageShellPaddingBottom: Number.parseFloat(getComputedStyle(document.querySelector('.page-shell')).paddingBottom) || 0,
      navigation: document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect().toJSON() || null
    };
  });
}

function expectMobileActionbarPosition(actionbar, { navigationVisible, bottomOffset, formPadding }) {
  expect(actionbar.position).toBe('fixed');
  expect(Boolean(actionbar.navigation)).toBe(navigationVisible);
  expect(Math.abs(actionbar.bottomGap - actionbar.bottomInset)).toBeLessThanOrEqual(1);
  expect(Math.abs(actionbar.bottomInset - bottomOffset)).toBeLessThanOrEqual(2);
  expect(actionbar.formPaddingBottom).toBe(formPadding);
  if (navigationVisible) {
    const gapAboveNavigation = actionbar.navigation.y - (actionbar.viewportHeight - actionbar.bottomGap);
    expect(gapAboveNavigation).toBeGreaterThanOrEqual(4);
    expect(gapAboveNavigation).toBeLessThanOrEqual(7);
  }
}

test('accessory settings stay distinct on phone and desktop', async ({ page }) => {
  const suffix = uniqueSuffix();
  await registerUser(page, suffix);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: { name: `Accessory layout ${suffix}` }
  });

  await page.setViewportSize({ width: 411, height: 684 });
  await page.goto(`/#/characters/${character.id}/edit`);
  await expect(page.locator('.character-mobile-hub')).toBeVisible();
  expectMobileActionbarPosition(await measureMobileActionbar(page), {
    navigationVisible: false,
    bottomOffset: 8,
    formPadding: 0
  });
  expect((await measureMobileActionbar(page)).pageShellPaddingBottom).toBeGreaterThanOrEqual(92);
  await captureScreenshot(page, 'mobile-411-editor-hub.png');

  await page.setViewportSize({ width: 373, height: 709 });
  await page.locator('.character-mobile-section-item[data-section-id="accessories"]').click();
  await expect(page.locator('#section-accessories')).toBeVisible();
  await page.getByRole('button', { name: '切换到夜间模式' }).click();
  await expect(page.getByRole('button', { name: '切换到日间模式' })).toBeVisible();
  await waitForThemeTransition(page);

  for (const viewport of [
    { width: 373, height: 709 },
    { width: 411, height: 684 },
    { width: 519, height: 930 }
  ]) {
    await page.setViewportSize(viewport);
    const phone = await measureAccessoryRows(page);
    expectMobileActionbarPosition(await measureMobileActionbar(page), {
      navigationVisible: false,
      bottomOffset: 8,
      formPadding: 0
    });
    expect(phone.overflow).toBeLessThanOrEqual(0);
    expect(phone.rows.length).toBeGreaterThan(0);
    for (const row of phone.rows) {
      expect(row.fields).toHaveLength(2);
      expect(row.fields[0].x).toBeGreaterThanOrEqual(row.bounds.x - 1);
      expect(row.fields[0].right).toBeLessThanOrEqual(row.bounds.right + 1);
      expect(row.fields[1].x).toBeGreaterThanOrEqual(row.bounds.x - 1);
      expect(row.fields[1].right).toBeLessThanOrEqual(row.bounds.right + 1);
      expect(row.fields[1].y).toBeGreaterThanOrEqual(row.fields[0].bottom);
    }

    await page.locator('.page-shell').evaluate((shell) => { shell.scrollTop = 0; });
    await captureScreenshot(page, `mobile-${viewport.width}-accessory.png`);
    if (viewport.width === 411) {
      await page.locator('.page-shell').evaluate((shell) => { shell.scrollTop = shell.scrollHeight; });
      await captureScreenshot(page, 'mobile-411-accessory-end.png');
      await page.locator('.page-shell').evaluate((shell) => { shell.scrollTop = 0; });
    }
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.character-studio')).toBeVisible();
  await page.locator('.character-studio-nav-item[data-section-id="accessories"]').click();
  await expect(page.locator('#section-accessories')).toBeVisible();

  const desktop = await measureAccessoryRows(page);
  expect(desktop.overflow).toBeLessThanOrEqual(0);
  for (const row of desktop.rows) {
    expect(row.fields).toHaveLength(2);
    expect(row.fields[0].right).toBeLessThanOrEqual(row.fields[1].x);
    expect(Math.abs(row.fields[0].y - row.fields[1].y)).toBeLessThanOrEqual(1);
  }

  await page.locator('.page-shell').evaluate((shell) => { shell.scrollTop = 0; });
  await captureScreenshot(page, 'desktop-accessory.png');

  await page.setViewportSize({ width: 411, height: 684 });
  await page.goto('/#/characters/new');
  await expect(page.locator('.character-mobile-hub')).toBeVisible();
  expectMobileActionbarPosition(await measureMobileActionbar(page), {
    navigationVisible: true,
    bottomOffset: 70,
    formPadding: 36
  });
  await captureScreenshot(page, 'mobile-411-character-create.png');
});
