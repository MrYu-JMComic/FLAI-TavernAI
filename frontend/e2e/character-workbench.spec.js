import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRequest, logoutUser, registerUser, uniqueSuffix } from './helpers.js';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const invalidAvatarPath = path.join(e2eDir, 'fixtures', 'not-an-image.png');
const validAvatarPath = path.resolve(e2eDir, '..', 'public', 'icons', 'favicon-32.png');

test('three-step creation validates the name, updates the summary, and enters edit mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const suffix = uniqueSuffix();
  await registerUser(page, suffix);
  await openCharacterCreator(page);

  const aside = page.locator('.character-studio-aside');
  await expect(page.getByRole('tablist', { name: '角色创建向导步骤' })).toBeVisible();
  await expect(aside.locator('.character-studio-progress-head span')).toHaveText('0 / 6');

  await aside.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('tab', { name: /角色设定/ })).toHaveAttribute('aria-selected', 'true');
  await aside.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('tab', { name: /高级配置/ })).toHaveAttribute('aria-selected', 'true');
  await aside.getByRole('button', { name: '创建角色' }).click();

  const nameInput = page.locator('#character-name');
  await expect(nameInput).toBeVisible();
  await expect(nameInput).toBeFocused();
  await expect(page.getByText('请输入角色名', { exact: true })).toBeVisible();

  const characterName = `工作台角色 ${suffix}`;
  await nameInput.fill(characterName);
  await expect(aside.locator('.character-studio-identity-text h2')).toHaveText(characterName);
  await expect(aside.locator('.character-studio-progress-head span')).toHaveText('1 / 6');

  const avatarInput = page.locator('#section-basic input[type="file"]');
  await avatarInput.setInputFiles(invalidAvatarPath);
  await expect(page.getByText('头像图片数据无效，请重新选择 PNG、JPG 或 WebP 图片', { exact: true })).toBeVisible();
  await expect(aside.locator('.character-studio-progress-head span')).toHaveText('1 / 6');

  await avatarInput.setInputFiles(validAvatarPath);
  await expect(aside.locator('.character-studio-progress-head span')).toHaveText('2 / 6');
  await page.getByRole('button', { name: '移除头像' }).click();
  await expect(aside.locator('.character-studio-progress-head span')).toHaveText('1 / 6');

  await aside.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('角色背景内容').fill('用于验证响应式角色创作工作台。');
  await page.getByLabel('角色世界观内容').fill('雨夜港口与旧书店组成的世界。');
  await page.getByLabel('角色人设内容').fill('冷静、敏锐、尊重事实。');
  await page.getByLabel('角色开场白内容').fill('欢迎来到雨夜港口。');
  await expect(aside.locator('.character-studio-progress-head span')).toHaveText('5 / 6');

  await aside.getByRole('button', { name: '下一步' }).click();
  await aside.getByRole('button', { name: '创建角色' }).click();
  await expect(page).toHaveURL(/#\/characters\/[^/]+\/edit/, { timeout: 15_000 });
  await expect(page.locator('.character-save-state')).toContainText('所有更改已保存');
  await expect(page.getByRole('button', { name: /角色图片/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /角色天赋/ })).toBeVisible();
});

test('the desktop studio renders the full form and protects unsaved navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerUser(page, uniqueSuffix());
  await openCharacterCreator(page);

  await page.getByRole('button', { name: /完整表单/ }).click();
  await expect(page.getByLabel('角色背景内容')).toBeVisible();
  await expect(page.locator('#section-basic')).toBeVisible();
  await page.locator('#character-name').fill('未保存的工作台角色');
  await expect(page.locator('.character-save-state')).toContainText('有未保存更改');

  // The directory remains available while the full form stays rendered.
  const nav = page.locator('.character-studio-nav');
  await nav.getByRole('button', { name: /角色设定/ }).click();
  await expect(page.getByLabel('角色背景内容')).toBeVisible();
  await expect(page.locator('#section-basic')).toBeVisible();

  const codeNavButton = nav.getByRole('button', { name: /扩展代码/ });
  await codeNavButton.click();
  await expect(codeNavButton).toHaveClass(/active/);
  const codeGroup = page.locator('#section-custom-code');
  await expect(codeGroup.getByRole('textbox', { name: '角色自定义 CSS' })).toBeVisible();
  await expect(page.locator('#section-settings')).toBeVisible();

  const cssEnabledCheckbox = codeGroup.getByRole('checkbox', { name: '启用角色自定义 CSS' });
  await cssEnabledCheckbox.check();
  await expect(cssEnabledCheckbox).toBeChecked();
  // The directory reflects per-section completion.
  await expect(codeNavButton.locator('.character-studio-nav-status')).toHaveText('已配');

  // Sequential stepping through the stage.
  await page.getByRole('button', { name: '上一分区' }).click();
  await expect(page.locator('#section-accessories')).toBeVisible();

  let leaveMessage = '';
  page.once('dialog', async (dialog) => {
    leaveMessage = dialog.message();
    await dialog.dismiss();
  });
  await page.locator('.character-editor-header').getByRole('button', { name: /返回/ }).click();
  expect(leaveMessage).toContain('未保存的更改');
  await expect(page).toHaveURL(/#\/characters\/new$/);
});

test('the phone shell drills from the section hub into a single section and saves', async ({ page }) => {
  const suffix = uniqueSuffix();
  await registerUser(page, suffix);
  // Register at the default width, then narrow: the home page hides its create
  // button on phones, and this test is about the editor, not that entry point.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#/characters/new');
  await expect(page.getByRole('heading', { name: /创建新的 AI 角色/ })).toBeVisible();

  // The mobile shell is its own component, not the desktop studio restyled.
  await expect(page.locator('.character-mobile-hub')).toBeVisible();
  await expect(page.locator('.character-studio')).toHaveCount(0);

  const basicItem = page.locator('.character-mobile-section-item[data-section-id="basic"]');
  await expect(basicItem).toBeVisible();
  await expect(page.locator('#character-name')).toHaveCount(0);

  await basicItem.click();
  const characterName = `手机角色 ${suffix}`;
  await page.locator('#character-name').fill(characterName);
  await page.getByRole('button', { name: '返回分区列表' }).click();

  await expect(page.locator('.character-mobile-hub')).toBeVisible();
  await expect(page.locator('.character-mobile-identity-text h2')).toHaveText(characterName);
  await expect(basicItem.locator('.character-mobile-section-status')).toHaveText('1/3');

  // The action bar must clear the app bottom nav and never cause a sideways scroll.
  const layout = await page.evaluate(() => {
    const bar = document.querySelector('.character-mobile-actionbar');
    const nav = document.querySelector('.mobile-bottom-nav');
    return {
      position: bar ? getComputedStyle(bar).position : '',
      barBottom: bar?.getBoundingClientRect().bottom || 0,
      navTop: nav?.getBoundingClientRect().top || 0,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  expect(layout.position).toBe('fixed');
  expect(layout.barBottom).toBeLessThanOrEqual(layout.navTop + 1);
  expect(layout.overflow).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: '创建角色' }).click();
  await expect(page).toHaveURL(/#\/characters\/[^/]+\/edit/, { timeout: 15_000 });

  // Rotating to a desktop width hands the same state to the desktop shell.
  await page.setViewportSize({ width: 1280, height: 812 });
  await expect(page.locator('.character-studio')).toBeVisible();
  await expect(page.locator('.character-studio-identity-text h2')).toHaveText(characterName);
});

test('public characters open read-only for non-owners on both shells', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerUser(page, uniqueSuffix());
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: {
      name: `公开只读角色 ${uniqueSuffix()}`,
      visibility: 'public',
      background: '只读验收背景。',
      worldview: '共享世界。',
      persona: '不可被其他用户修改。',
      openingMessage: '这是一张公开角色卡。'
    }
  });

  await logoutUser(page);
  await registerUser(page, uniqueSuffix());
  await page.goto(`/#/characters/${character.id}/edit`);

  await expect(page.locator('.character-editor-header h1')).toHaveText(character.name);
  await expect(page.getByText(/只能查看和发起对话/)).toBeVisible();
  await expect(page.locator('#character-name')).toBeDisabled();
  await expect(page.locator('.character-studio-actions').getByRole('button', { name: '返回角色列表' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存角色' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除角色' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出角色' })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.character-mobile-hub')).toBeVisible();
  await expect(page.getByRole('button', { name: '返回角色列表' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存角色' })).toHaveCount(0);
});

async function openCharacterCreator(page) {
  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await expect(page.getByRole('heading', { name: /创建新的 AI 角色/ })).toBeVisible();
}
