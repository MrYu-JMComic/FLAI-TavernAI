import { expect, test } from '@playwright/test';
import { registerUser } from './helpers.js';

test('Personal Center routes stay focused and fit desktop and mobile widths', async ({ page }, testInfo) => {
  await registerUser(page);
  await page.getByRole('button', { name: '个人', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.locator('.settings-page-title')).toHaveText('个人中心');
  await expect(page.locator('.settings-page-title')).toHaveClass(/visually-hidden/);
  await expect(page.locator('.personal-center-overview')).toBeVisible();
  await expect(page.locator('#settings-profile-panel, #settings-provider-panel, #settings-presets-panel, #settings-data-panel')).toHaveCount(0);

  const overviewScreenshots = [
    { width: 1440, height: 900, name: 'personal-center-1440x900.png' },
    { width: 519, height: 930, name: 'personal-center-519x930.png' },
    { width: 320, height: 844, name: 'personal-center-320x844.png' }
  ];

  for (const viewport of overviewScreenshots) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.locator('.personal-center-destination')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(viewport.name), fullPage: true, animations: 'disabled' });
  }

  const detailPages = [
    { path: 'settings/profile', heading: '个人资料', panel: '#settings-profile-panel', screenshot: 'personal-center-profile.png' },
    { path: 'settings/presets', heading: '对话预设', panel: '#settings-presets-panel', screenshot: 'personal-center-presets.png' },
    { path: 'settings/provider', heading: '模型网关', panel: '#settings-provider-panel', screenshot: 'personal-center-provider.png' },
    { path: 'settings/data', heading: '数据导出', panel: '#settings-data-panel', screenshot: 'personal-center-data.png' }
  ];

  await page.setViewportSize({ width: 519, height: 930 });
  for (const detail of detailPages) {
    await page.goto(`/#/${detail.path}`);
    await expect(page.locator('.settings-page-title')).toHaveText(detail.heading);
    await expect(page.locator('.settings-page-title')).toHaveClass(/visually-hidden/);
    await expect(page.locator(detail.panel)).toBeVisible();
    await expect(page.locator('.mobile-bottom-nav')).toHaveCount(0);
    await expect(page.locator('.personal-center-overview')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(519);
    if (detail.path === 'settings/profile') {
      const profileFields = page.locator('.profile-fields > .field');
      const fieldBoxes = await profileFields.evaluateAll((fields) => fields.map((field) => {
        const { top, bottom } = field.getBoundingClientRect();
        return { top, bottom };
      }));
      expect(fieldBoxes).toHaveLength(2);
      expect(fieldBoxes[0].bottom).toBeLessThanOrEqual(fieldBoxes[1].top);

      for (const width of [519, 991]) {
        await page.setViewportSize({ width, height: 930 });
        const avatarBox = await page.locator('.profile-overview > .profile-avatar').boundingBox();
        const identityBox = await page.locator('.profile-identity').boundingBox();
        expect(avatarBox).not.toBeNull();
        expect(identityBox).not.toBeNull();
        expect(avatarBox.x + avatarBox.width).toBeLessThanOrEqual(identityBox.x);
        if (width === 991) {
          await page.screenshot({ path: testInfo.outputPath('personal-center-profile-991.png'), fullPage: true, animations: 'disabled' });
        }
      }
      await page.setViewportSize({ width: 519, height: 930 });
    }
    await page.screenshot({ path: testInfo.outputPath(detail.screenshot), fullPage: true, animations: 'disabled' });
    const backButton = page.getByRole('button', { name: '返回个人中心' });
    await expect(backButton).toBeVisible();
    const buttonBox = await backButton.boundingBox();
    const panelBox = await page.locator(detail.panel).boundingBox();
    expect(buttonBox.x).toBeLessThan(panelBox.x + 8);
    expect(buttonBox.y).toBeLessThan(panelBox.y);
    await backButton.click();
    await expect(page).toHaveURL(/#\/settings$/);
  }

  await page.goto('/#/presets');
  await expect(page).toHaveURL(/#\/settings\/presets$/);
  await expect(page.locator('.settings-page-title')).toHaveText('对话预设');
  await expect(page.locator('.settings-page-title')).toHaveClass(/visually-hidden/);
  await expect(page.locator('.mobile-bottom-nav')).toHaveCount(0);
});
