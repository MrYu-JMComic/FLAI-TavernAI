import { expect, test } from '@playwright/test';
import { apiRequest, uniqueSuffix } from './helpers.js';

async function registerWorkspaceUser(page) {
  const suffix = uniqueSuffix();
  const username = `e2e_heading_${suffix}`;
  const password = `e2e-pass-${suffix}`;

  await page.goto('/#/register');
  await expect(page.getByRole('heading', { name: /注册 FLAI Tavern AI/ })).toBeVisible();
  await page.locator('#auth-username').fill(username);
  await page.locator('#auth-password').fill(password);
  await page.locator('#auth-confirm-password').fill(password);
  await page.getByRole('button', { name: /注册并进入/ }).click();
  await expect(page.locator('.home-library-header').getByRole('button', { name: '创建角色', exact: true })).toBeVisible();
}

async function expectTitleNotVisible(locator) {
  if (await locator.count()) {
    await expect(locator).toHaveClass(/visually-hidden/);
  }
}

async function capturePage(page, testInfo, name, width) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' });
}

test('removes page title bands while keeping page actions and return navigation', async ({ page }, testInfo) => {
  await registerWorkspaceUser(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await capturePage(page, testInfo, 'headings-home-1440x900.png', 1440);

  await page.setViewportSize({ width: 519, height: 930 });
  await capturePage(page, testInfo, 'headings-home-519x930.png', 519);

  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: {
      name: `标题回归角色 ${uniqueSuffix()}`,
      persona: '标题清理测试角色。',
      openingMessage: '你好。'
    }
  });
  const worldBook = await apiRequest(page, '/api/world-books', {
    method: 'POST',
    body: {
      name: `标题回归世界书 ${uniqueSuffix()}`,
      description: '用于标题区回归检查。',
      scanDepth: 4,
      lorebookContextPercent: 25
    }
  });

  await expectTitleNotVisible(page.locator('.home-library-header h1'));
  await expect(page.locator('.home-library-header').getByRole('button', { name: '创建角色', exact: true })).toBeEnabled();
  await expect(page.locator('.home-library-header .home-file-action input[type="file"]')).toBeEnabled();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/#/characters/${character.id}/edit`);
  await expect(page.locator('#character-name')).toHaveValue(character.name);
  await expectTitleNotVisible(page.locator('.character-editor-header h1'));
  await expect(page.getByRole('button', { name: '预览角色卡', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'AI 完善助手', exact: true })).toBeEnabled();
  await capturePage(page, testInfo, 'headings-character-editor-1280x900.png', 1280);
  await page.setViewportSize({ width: 519, height: 930 });
  await capturePage(page, testInfo, 'headings-character-editor-519x930.png', 519);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '预览角色卡', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '角色卡预览', exact: true });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: '关闭角色卡预览', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);

  await page.setViewportSize({ width: 519, height: 930 });
  await page.goto('/#/settings');
  await expect(page.locator('.personal-center-overview')).toBeVisible();
  await expectTitleNotVisible(page.locator('.settings-page-title'));
  await capturePage(page, testInfo, 'headings-personal-center-519x930.png', 519);
  await page.setViewportSize({ width: 1440, height: 900 });
  await capturePage(page, testInfo, 'headings-personal-center-1440x900.png', 1440);

  const personalDetails = [
    { path: 'profile', panel: '#settings-profile-panel' },
    { path: 'presets', panel: '#settings-presets-panel' },
    { path: 'provider', panel: '#settings-provider-panel' },
    { path: 'data', panel: '#settings-data-panel' }
  ];
  for (const detail of personalDetails) {
    await page.setViewportSize({ width: 519, height: 930 });
    await page.goto(`/#/settings/${detail.path}`);
    await expect(page.locator(detail.panel)).toBeVisible();
    await expectTitleNotVisible(page.locator('.settings-page-title'));
    const backToPersonalCenter = page.getByRole('button', { name: '返回个人中心', exact: true });
    await expect(backToPersonalCenter).toBeVisible();
    await capturePage(page, testInfo, `headings-settings-${detail.path}-519x930.png`, 519);
    await page.setViewportSize({ width: 1440, height: 900 });
    await capturePage(page, testInfo, `headings-settings-${detail.path}-1440x900.png`, 1440);
    await backToPersonalCenter.click();
    await expect(page).toHaveURL(/#\/settings$/);
  }

  await page.setViewportSize({ width: 519, height: 930 });
  await page.goto('/#/extensions');
  await expectTitleNotVisible(page.locator('.settings-page-title'));
  const extensionSections = page.getByRole('navigation', { name: '扩展管理分区' });
  await expect(extensionSections).toBeVisible();
  await capturePage(page, testInfo, 'headings-extensions-519x930.png', 519);
  await page.setViewportSize({ width: 1440, height: 900 });
  await capturePage(page, testInfo, 'headings-extensions-1440x900.png', 1440);
  const regexSection = extensionSections.getByRole('button', { name: '正则规则', exact: true });
  await regexSection.click();
  await expect(regexSection).toHaveAttribute('aria-current', 'location');

  await page.setViewportSize({ width: 519, height: 930 });
  await page.goto('/#/world-books');
  await expect(page.locator('.worldbook-overview')).toBeVisible();
  await expectTitleNotVisible(page.locator('.worldbook-overview h1'));
  const newWorldBook = page.locator('.worldbook-overview-actions').getByRole('button', { name: '新建世界书', exact: true });
  await expect(newWorldBook).toBeEnabled();
  await capturePage(page, testInfo, 'headings-world-books-519x930.png', 519);
  await page.setViewportSize({ width: 1440, height: 900 });
  await capturePage(page, testInfo, 'headings-world-books-1440x900.png', 1440);
  await newWorldBook.click();
  await expect(page.getByRole('heading', { name: '新建世界书', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await page.setViewportSize({ width: 519, height: 930 });
  await page.goto(`/#/world-books/${worldBook.id}`);
  await expect(page.locator('.book-info-panel')).toBeVisible();
  await expectTitleNotVisible(page.locator('.worldbook-detail-toolbar h1'));
  const backToWorldBooks = page.getByRole('button', { name: '返回列表', exact: true });
  await expect(backToWorldBooks).toBeVisible();
  await capturePage(page, testInfo, 'headings-world-book-detail-519x930.png', 519);
  await page.setViewportSize({ width: 1440, height: 900 });
  await capturePage(page, testInfo, 'headings-world-book-detail-1440x900.png', 1440);
  await backToWorldBooks.click();
  await expect(page).toHaveURL(/#\/world-books$/);

  await page.setViewportSize({ width: 519, height: 930 });
  await page.goto('/#/admin');
  await expectTitleNotVisible(page.locator('.admin-page-toolbar h1'));
  await expect(page.getByRole('heading', { name: '需要根管理员权限', exact: true })).toBeVisible();
  await capturePage(page, testInfo, 'headings-admin-519x930.png', 519);
  await page.setViewportSize({ width: 1440, height: 900 });
  await capturePage(page, testInfo, 'headings-admin-1440x900.png', 1440);
});
