import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerUser } from './helpers.js';

test('applies shared typography and focus polish across desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await registerUser(page);

  const outputDirectory = path.resolve(process.cwd(), '..', '.runtime-check');
  const search = page.locator('#home-character-search');
  const searchField = page.locator('.home-search-field');
  const heading = page.locator('.home-library-heading h1');
  await search.focus();
  const focusShadow = await searchField.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(focusShadow).toContain('inset');
  expect(await search.evaluate((element) => getComputedStyle(element).boxShadow)).toBe('none');
  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).fontVariantNumeric)).toContain('tabular-nums');
  expect(await search.evaluate((element) => getComputedStyle(element).textWrap)).toBe('pretty');
  await page.screenshot({ path: path.join(outputDirectory, 'design-polish-home-light-desktop.png') });

  const lightHeadingWeight = Number(await heading.evaluate((element) => getComputedStyle(element).fontWeight));
  await page.getByRole('button', { name: '切换到夜间模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => heading.evaluate((element) => getComputedStyle(element).fontWeight)).toBe(String(Math.max(100, lightHeadingWeight - 100)));
  const primaryAction = page.locator('.home-primary-action:visible').first();
  await expect(primaryAction).toHaveCSS('color', 'rgb(22, 25, 29)');
  const contrastRatio = await primaryAction.evaluate((element) => {
    const luminance = (color) => {
      const channels = color.match(/[0-9.]+/g).slice(0, 3).map(Number)
        .map((channel) => channel > 1 ? channel / 255 : channel);
      const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const styles = getComputedStyle(element);
    const foreground = luminance(styles.color);
    const background = luminance(styles.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrastRatio).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(outputDirectory, 'design-polish-home-dark-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: path.join(outputDirectory, 'design-polish-home-dark-mobile.png'), fullPage: true });
});
