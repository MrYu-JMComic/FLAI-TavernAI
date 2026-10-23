import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

const eventTemplate = `<style>
  .event-section { margin: 8px 0; padding: 10px; border: 1px solid #b06f83; border-radius: 8px; }
  .event-content { padding: 8px; }
  @media (min-width: 1px) { .event-content { color: #ff69b4; } }
</style>
<section class="event-section">
  <button type="button" onclick="this.nextElementSibling.classList.toggle('sb-hidden'); this.dataset.literal='{{#if JavaScriptLiteral}}'">装备</button>
  <div class="event-content">HP <output class="preview-hp">{{HP}}</output></div>
</section>
<section class="event-section">
  <button type="button" onclick="this.nextElementSibling.classList.toggle('sb-hidden')">故事</button>
  <div class="event-content">{{char}} 的旅程</div>
</section>
<button type="button" onclick="api.setVariable('HP', values.HP + 1)">增加预览 HP</button>`;

async function openCharacterAssistant(page, template = eventTemplate) {
  await registerUser(page);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: {
      name: `Preview ${uniqueSuffix()}`, openingMessage: 'Status preview test.',
      authorAdvancedSettings: { statusBarBlueprint: {
        name: '旅程面板', template, variables: [{ name: 'HP', type: 'number', value: 5 }]
      } }
    }
  });
  await page.goto(`/#/characters/${character.id}/assistant`);
  await expect(page.getByRole('textbox', { name: '给角色助手发送消息' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '保存角色', exact: true })).toBeEnabled();
  return character;
}

async function saveCharacter(page, id, template) {
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/characters/${id}`)
    && response.request().method() === 'PATCH' && response.ok());
  await page.getByRole('button', { name: '保存角色', exact: true }).click();
  expect((await (await saved).json()).authorAdvancedSettings.statusBarBlueprint.template).toBe(template);
  await expect(page.getByText('角色已保存', { exact: true })).toBeVisible();
}

test('assistant previews inline event templates with independent sections and local variable changes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const character = await openCharacterAssistant(page);
  const savedCharacter = await apiRequest(page, `/api/characters/${character.id}`);
  const sessions = await apiRequest(page, `/api/character-assistant/sessions?characterId=${character.id}`);
  await apiRequest(page, `/api/character-assistant/sessions/${sessions[0].id}`, {
    method: 'PATCH', body: {
      characterId: character.id, title: '尚未保存的状态栏草稿',
      character: { ...savedCharacter, authorAdvancedSettings: {
        ...savedCharacter.authorAdvancedSettings,
        statusBarBlueprint: { ...savedCharacter.authorAdvancedSettings.statusBarBlueprint,
          template: eventTemplate.replace('的旅程', '的未保存旅程') }
      } }
    }
  });
  await page.reload();
  const opener = page.getByRole('button', { name: '预览状态栏', exact: true });
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '状态栏预览', exact: true });
  const runtime = page.frameLocator('.status-preview-dialog iframe');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('header p')).toContainText('当前草稿');
  await expect(runtime.locator('.preview-hp')).toHaveText('5');
  await expect(runtime.locator('.event-content').nth(1)).toContainText('的未保存旅程');
  await expect(runtime.locator('.event-content').first()).toHaveCSS('color', 'rgb(255, 105, 180)');
  await runtime.getByRole('button', { name: '装备', exact: true }).click();
  await expect(runtime.locator('.event-content').first()).toBeHidden();
  await expect(runtime.locator('.event-content').nth(1)).toBeVisible();
  await expect(runtime.getByRole('button', { name: '装备', exact: true })).toHaveAttribute('data-literal', '{{#if JavaScriptLiteral}}');
  await runtime.getByRole('button', { name: '增加预览 HP', exact: true }).click();
  await expect(runtime.locator('.preview-hp')).toHaveText('6');
  await expect(runtime.locator('.event-content').first()).toBeHidden();
  await expect(runtime.locator('.event-content').nth(1)).toBeVisible();
  const unchanged = await apiRequest(page, `/api/characters/${character.id}`);
  expect(unchanged.authorAdvancedSettings.statusBarBlueprint.template).toBe(eventTemplate);
  expect(unchanged.authorAdvancedSettings.statusBarBlueprint.variables.find(variable => variable.name === 'HP').value).toBe(5);
  await page.screenshot({ path: testInfo.outputPath('assistant-status-preview-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await saveCharacter(page, character.id, eventTemplate.replace('的旅程', '的未保存旅程'));
  const persisted = await apiRequest(page, `/api/characters/${character.id}`);
  expect(persisted.authorAdvancedSettings.statusBarBlueprint.variables.find(variable => variable.name === 'HP').value).toBe(5);
  await opener.click();
  await expect(dialog.locator('header p')).toContainText('当前草稿');
  await expect(runtime.locator('.event-content').nth(1)).toContainText('的未保存旅程');
  await expect(runtime.locator('.preview-hp')).toHaveText('5');
  await dialog.getByRole('button', { name: '关闭状态栏预览', exact: true }).click();
});

test('invalid template source can be saved and runtime errors are shown in preview', async ({ page }) => {
  const template = '<p>{{#if 未闭合</p><script>throw new Error("可在预览查看的脚本错误");</script>';
  const character = await openCharacterAssistant(page, template);
  await saveCharacter(page, character.id, template);
  await page.getByRole('button', { name: '预览状态栏', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '状态栏预览', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('可在预览查看的脚本错误');
  await expect(dialog.getByRole('button', { name: '重新运行', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '关闭状态栏预览', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('preview stays on the current draft until the saved card explicitly replaces it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const character = await openCharacterAssistant(page);
  const saved = await apiRequest(page, `/api/characters/${character.id}`);
  const [session] = await apiRequest(page, `/api/character-assistant/sessions?characterId=${character.id}`);
  const draftBefore = await apiRequest(page, `/api/character-assistant/sessions/${session.id}`);
  await apiRequest(page, `/api/characters/${character.id}`, { method: 'PATCH', body: {
    ...saved, name: '外部保存的新角色名',
    authorAdvancedSettings: { ...saved.authorAdvancedSettings, statusBarBlueprint: {
      ...saved.authorAdvancedSettings.statusBarBlueprint,
      template: eventTemplate.replace('的旅程', '的外部更新旅程'), variables: [{ name: 'HP', type: 'number', value: 11 }]
    } }
  } });

  const characterPath = `**/api/characters/${character.id}`;
  let characterReads = 0;
  const blockSavedCardReads = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    characterReads += 1;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '预览不应读取正式角色卡' }) });
  };
  await page.route(characterPath, blockSavedCardReads);
  const opener = page.getByRole('button', { name: '预览状态栏', exact: true });
  const dialog = page.getByRole('dialog', { name: '状态栏预览', exact: true });
  const runtime = page.frameLocator('.status-preview-dialog iframe');
  await opener.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('header p')).toContainText('当前草稿');
  await expect(runtime.locator('.event-content').nth(1)).toHaveText(`${character.name} 的旅程`);
  await expect(runtime.locator('.preview-hp')).toHaveText('5');
  expect(characterReads).toBe(0);
  await dialog.getByRole('button', { name: '关闭状态栏预览', exact: true }).click();
  await expect(page.locator('.character-assistant-heading h1')).toHaveText(character.name);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.unroute(characterPath, blockSavedCardReads);
  const draftAfter = await apiRequest(page, `/api/character-assistant/sessions/${session.id}`);
  expect(draftAfter.character).toEqual(draftBefore.character);
  expect(draftAfter.messages).toEqual(draftBefore.messages);
  expect(draftAfter.state).toEqual(draftBefore.state);

  await page.getByRole('button', { name: '草稿历史版本', exact: true }).click();
  const history = page.getByRole('dialog', { name: '草稿历史版本', exact: true });
  page.once('dialog', dialog => dialog.accept());
  await history.getByRole('button', { name: '用已保存角色卡覆盖草稿', exact: true }).click();
  await expect(history.getByText('已用已保存角色卡覆盖当前草稿。', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: '关闭历史版本', exact: true }).click();
  await opener.click();
  await expect(dialog.locator('header p')).toContainText('当前草稿');
  await expect(runtime.locator('.event-content').nth(1)).toContainText('外部保存的新角色名 的外部更新旅程');
  await expect(runtime.locator('.preview-hp')).toHaveText('11');
  await dialog.getByRole('button', { name: '关闭状态栏预览', exact: true }).click();
  await saveCharacter(page, character.id, eventTemplate.replace('的旅程', '的外部更新旅程'));
  const preserved = await apiRequest(page, `/api/characters/${character.id}`);
  expect(preserved.name).toBe('外部保存的新角色名');
  expect(preserved.authorAdvancedSettings.statusBarBlueprint.variables.find(variable => variable.name === 'HP').value).toBe(11);
});

test.describe('status preview on phones', () => {
  test.use({ isMobile: true, hasTouch: true });
  test('opens from the assistant menu and stays within the phone viewport', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerUser(page);
    const character = await apiRequest(page, '/api/characters', { method: 'POST', body: {
      name: '手机状态预览', authorAdvancedSettings: { statusBarBlueprint: {
        name: '旅程面板', template: eventTemplate, variables: [{ name: 'HP', type: 'number', value: 5 }]
      } }
    } });
    await page.goto(`/#/characters/${character.id}/assistant`);
    await expect(page.getByRole('textbox', { name: '给角色助手发送消息' })).toBeEnabled();
    await page.getByRole('button', { name: '更多助手操作', exact: true }).click();
    await page.getByRole('button', { name: '预览状态栏', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '状态栏预览', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('header p')).toContainText('当前草稿');
    const runtime = page.frameLocator('.status-preview-dialog iframe');
    await expect(runtime.locator('.preview-hp')).toHaveText('5');
    await runtime.getByRole('button', { name: '故事', exact: true }).click();
    await expect(runtime.locator('.event-content').nth(1)).toBeHidden();
    await expect(runtime.locator('.event-content').first()).toBeVisible();
    await expect.poll(() => dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('assistant-status-preview-mobile.png') });
    await dialog.getByRole('button', { name: '关闭状态栏预览', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '给角色助手发送消息' })).toBeEnabled();
  });
});
