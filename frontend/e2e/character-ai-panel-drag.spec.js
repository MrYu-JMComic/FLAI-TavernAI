import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('assistant conversations persist, bind to a new character and stay usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await registerUser(page, uniqueSuffix());
  const roleName = `Assistant ${account.suffix}`;
  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await expect(page.locator('.character-editor-header h1')).toHaveText('创建新的 AI 角色');
  await expect(page.locator('.character-editor-header h1')).toHaveClass(/visually-hidden/);
  await page.locator('#character-name').fill(roleName);
  await page.getByRole('button', { name: 'AI 完善助手', exact: true }).click();

  const workspace = page.locator('.character-assistant-page');
  await expect(page).toHaveURL(/#\/characters\/new\/assistant$/);
  await expect(workspace.locator('.assistant-new-session')).toBeEnabled();
  await expect(workspace.locator('.assistant-session-row')).toHaveCount(1);
  const composer = workspace.getByRole('textbox', { name: '给角色助手发送消息' });
  await composer.fill('保留当前草稿并检查结构');
  await workspace.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(workspace.locator('.assistant-message.from-user')).toContainText('保留当前草稿并检查结构');
  await expect(workspace.locator('.assistant-message.from-assistant')).toHaveCount(1);
  await expect(workspace.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect(workspace.locator('.assistant-message.from-assistant')).toContainText('当前使用本地 Mock');
  await expect(workspace.locator('.assistant-context-inspector')).toContainText('上下文');
  await workspace.locator('.assistant-context-inspector summary').click();
  await expect(workspace.locator('.assistant-context-body')).toContainText('缓存命中以模型服务实际返回为准');
  await workspace.locator('.assistant-context-inspector summary').click();
  await page.screenshot({ path: '../.runtime-check/assistant-workspace-desktop.png', fullPage: true });

  await workspace.getByRole('button', { name: '预览角色卡' }).click();
  await expect(page.getByRole('dialog', { name: '角色卡预览' })).toContainText(roleName);
  await page.screenshot({ path: '../.runtime-check/assistant-card-preview.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '角色卡预览' })).toHaveCount(0);
  await workspace.getByRole('button', { name: '创建角色', exact: true }).click();
  await expect(page).toHaveURL(/#\/characters\/(?!new\/)[^/]+\/assistant$/);
  const characterId = /#\/characters\/([^/]+)\/assistant$/.exec(page.url())[1];
  await expect(workspace.locator('.assistant-session-row')).toHaveCount(1);
  const sessions = await apiRequest(page, `/api/character-assistant/sessions?characterId=${characterId}`);
  expect(sessions).toHaveLength(1);
  expect(sessions[0].characterId).toBe(characterId);

  await page.reload();
  await expect(workspace.locator('.assistant-message.from-user')).toContainText('保留当前草稿并检查结构');
  await expect(workspace.locator('.assistant-message.from-assistant')).toHaveCount(1);
  await composer.fill('继续检查开场白');
  await composer.press('Enter');
  await expect(workspace.locator('.assistant-message.from-assistant')).toHaveCount(2);
  await expect(composer).toHaveValue('');

  await workspace.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(workspace.locator('.assistant-session-row')).toHaveCount(2);
  await expect(workspace.locator('.assistant-welcome')).toBeVisible();
  await workspace.locator('.assistant-session-select').filter({ hasText: roleName }).click();
  await expect(workspace.locator('.assistant-message.from-assistant')).toHaveCount(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(composer).toBeVisible();
  await workspace.getByRole('button', { name: '会话', exact: true }).click();
  const sessionDialog = workspace.getByRole('dialog', { name: '助手会话' });
  const closeSessions = sessionDialog.getByRole('button', { name: '关闭会话列表', exact: true });
  await expect(closeSessions).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(sessionDialog.getByRole('button', { name: /删除会话/ }).last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeSessions).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sessionDialog).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: '会话', exact: true })).toBeFocused();
  await workspace.getByRole('button', { name: '会话', exact: true }).click();
  await expect(workspace.getByRole('button', { name: '新建会话', exact: true })).toBeVisible();
  const emptySession = workspace.locator('.assistant-session-row').filter({ hasNotText: roleName });
  page.once('dialog', (dialog) => dialog.accept());
  await emptySession.getByRole('button', { name: /删除会话/ }).click();
  await expect(workspace.locator('.assistant-session-row')).toHaveCount(1);
  await workspace.getByRole('button', { name: '关闭会话列表', exact: true }).last().click();
  await workspace.getByRole('button', { name: /范围/ }).click();
  await expect(workspace.locator('.assistant-scope-options label')).toHaveCount(11);
  await expect(workspace.getByRole('button', { name: '新建世界书', exact: true })).toBeVisible();
  await workspace.getByLabel('流式响应').check();
  await expect(workspace.getByLabel('流式响应')).toBeChecked();
  await workspace.getByRole('button', { name: '收起对话设置', exact: true }).click();
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
    await expect.poll(() => workspace.evaluate((element) => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, pagePadding: getComputedStyle(element.parentElement).padding }))).toEqual({ x: 0, y: 0, pagePadding: '0px' });
    await expect(workspace.getByRole('button', { name: '新建助手会话', exact: true })).toBeVisible();
    await expect(composer).toBeVisible();
    const composerBounds = await workspace.locator('.assistant-composer-area').boundingBox();
    expect(composerBounds.y + composerBounds.height).toBeLessThanOrEqual(viewport.height);
    await expect.poll(() => workspace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const screenshot = viewport.width === 390 ? 'assistant-workspace-mobile.png' : `assistant-workspace-mobile-${viewport.width}.png`;
    await page.screenshot({ path: `../.runtime-check/${screenshot}`, fullPage: true });
  }
  await composer.fill('桌面窄屏仍通过 Enter 发送');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(workspace.locator('.assistant-message.from-user')).toHaveCount(3);
});

test.describe('touch keyboard behavior', () => {
  test.use({ isMobile: true, hasTouch: true });
  test('phone Enter inserts newlines in portrait and landscape until the send button is pressed', async ({ page }) => {
    await registerUser(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/characters/new/assistant');
    const assistant = page.locator('.character-assistant-page');
    const composer = assistant.getByRole('textbox', { name: '给角色助手发送消息' });
    await expect(composer).toBeEnabled();
    await composer.fill('先讨论角色动机');
    await composer.press('Enter');
    await composer.pressSequentially('再讨论人物关系');
    await expect(composer).toHaveValue('先讨论角色动机\n再讨论人物关系');
    await expect(assistant.locator('.assistant-message.from-user')).toHaveCount(0);
    await page.screenshot({ path: '../.runtime-check/assistant-mobile-multiline.png', fullPage: true });
    await page.setViewportSize({ width: 844, height: 390 });
    await composer.press('Enter');
    await composer.pressSequentially('补充故事背景');
    await expect(composer).toHaveValue('先讨论角色动机\n再讨论人物关系\n补充故事背景');
    await expect(assistant.locator('.assistant-message.from-user')).toHaveCount(0);
    await assistant.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(composer).toHaveValue('');
    await expect(assistant.locator('.assistant-message.from-user')).toHaveCount(1);
  });

  test('phone model picker keeps the keyboard closed until search and fits a reduced visual viewport', async ({ page }) => {
    await registerUser(page);
    await apiRequest(page, '/api/providers', { method: 'POST', body: { providerType: 'custom', gatewayName: '手机模型网关', baseUrl: 'https://assistant-mobile.example/v1', model: 'phone-model-00', extraBody: '{}' } });
    await page.route('**/api/providers/models', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: Array.from({ length: 100 }, (_, index) => ({ id: `phone-model-${String(index).padStart(2, '0')}` })) }) }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/characters/new/assistant');
    const modelButton = page.getByRole('button', { name: /选择助手模型/ });
    await modelButton.click();
    const picker = page.getByRole('dialog', { name: '选择助手模型', exact: true });
    const search = picker.getByRole('searchbox', { name: '搜索助手模型' });
    await expect(picker.getByRole('button', { name: '关闭模型选择', exact: true })).toBeFocused();
    await expect(search).not.toBeFocused();
    await picker.getByRole('button', { name: '手机模型网关', exact: true }).click();
    await expect(picker.locator('.assistant-model-picker-option')).toHaveCount(101);
    await search.tap();
    await expect(search).toBeFocused();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 360 });
      Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 40 });
      window.visualViewport.dispatchEvent(new Event('resize'));
      window.visualViewport.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(async () => {
      const bounds = await picker.boundingBox();
      return bounds.y >= 40 && bounds.y + bounds.height <= 400;
    }).toBe(true);
    const searchBounds = await search.boundingBox();
    expect(searchBounds.y).toBeGreaterThanOrEqual(40);
    expect(searchBounds.y + searchBounds.height).toBeLessThanOrEqual(400);
    await page.screenshot({ path: '../.runtime-check/assistant-model-picker-keyboard.png', fullPage: true });
    await picker.getByRole('button', { name: '关闭模型选择', exact: true }).tap();
    await expect(picker).toHaveCount(0);
    await expect(modelButton).toBeFocused();
  });
});

test('assistant model picker searches saved gateway catalogs without changing the global provider', async ({ page }) => {
  await registerUser(page);
  const profiles = [];
  for (const gateway of ['A', 'B']) {
    const result = await apiRequest(page, '/api/providers', {
      method: 'POST', body: { providerType: 'custom', gatewayName: `助手网关 ${gateway}`, baseUrl: `https://assistant-${gateway.toLowerCase()}.example/v1`, model: `${gateway.toLowerCase()}-model-00`, supportsReasoning: true, extraBody: '{}' }
    });
    profiles.push(result.provider);
  }
  await apiRequest(page, `/api/providers/${profiles[0].id}/select`, { method: 'POST' });
  const catalogs = [];
  let failRefresh = false;
  await page.route('**/api/providers/models', async (route) => {
    const payload = route.request().postDataJSON();
    catalogs.push(payload);
    if (failRefresh) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '暂时无法获取模型' }) });
    const prefix = payload.providerId === profiles[1].id ? 'b' : 'a';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: Array.from({ length: 100 }, (_, index) => ({ id: `${prefix}-model-${String(index).padStart(2, '0')}` })) }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/characters/new/assistant');
  const assistant = page.locator('.character-assistant-page');
  const modelButton = assistant.getByRole('button', { name: /选择助手模型/ });
  await modelButton.click();
  const picker = page.getByRole('dialog', { name: '选择助手模型', exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.locator('select')).toHaveCount(0);
  await expect(picker.getByRole('searchbox', { name: '搜索助手模型' })).toBeFocused();
  await picker.getByRole('button', { name: '助手网关 B', exact: true }).click();
  await expect.poll(() => catalogs.some((request) => request.providerId === profiles[1].id)).toBe(true);
  await expect(picker.locator('.assistant-model-picker-option')).toHaveCount(101);
  await expect.poll(() => picker.locator('.assistant-model-picker-list').evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
  await page.screenshot({ path: '../.runtime-check/assistant-model-picker-mobile-list.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  expect((await picker.boundingBox()).width).toBeLessThanOrEqual(292);
  await page.screenshot({ path: '../.runtime-check/assistant-model-picker-320.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '../.runtime-check/assistant-model-picker-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.getByRole('searchbox', { name: '搜索助手模型' }).fill('b-model-77');
  await expect(picker.locator('.assistant-model-picker-option')).toHaveCount(1);
  const bounds = await picker.boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(420);
  expect(bounds.height).toBeLessThanOrEqual(844 * .65 + 1);
  await page.screenshot({ path: '../.runtime-check/assistant-model-picker-mobile.png', fullPage: true });
  await picker.getByRole('button', { name: 'b-model-77', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(modelButton).toContainText('b-model-77');
  await expect(modelButton).toBeFocused();
  await expect.poll(async () => {
    const state = (await apiRequest(page, '/api/character-assistant/sessions?unbound=true'))[0]?.state;
    return { providerProfileId: state?.providerProfileId, modelOverride: state?.modelOverride };
  }).toEqual({ providerProfileId: profiles[1].id, modelOverride: 'b-model-77' });
  expect((await apiRequest(page, '/api/providers')).selectedProviderId).toBe(profiles[0].id);

  await page.reload();
  await expect(modelButton).toContainText('b-model-77');
  await modelButton.click();
  await expect(picker.getByRole('button', { name: '助手网关 B', exact: true })).toHaveAttribute('aria-pressed', 'true');
  failRefresh = true;
  await picker.getByRole('button', { name: '刷新助手模型', exact: true }).click();
  await expect(picker.getByRole('alert')).toContainText('暂时无法获取模型');
  failRefresh = false;
  await picker.getByRole('button', { name: '重试', exact: true }).click();
  await expect(picker.getByRole('alert')).toHaveCount(0);
  await picker.getByRole('button', { name: '跟随全局网关', exact: true }).click();
  await expect(picker.getByRole('button', { name: '跟随全局网关', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(modelButton).toContainText('使用全局模型');
});

test('temporary conversation survives editor handoffs and binds when the editor creates the character', async ({ page }) => {
  const account = await registerUser(page, uniqueSuffix());
  const roleName = `Handoff ${account.suffix}`;
  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await page.locator('#character-name').fill(roleName);
  await page.getByRole('button', { name: 'AI 完善助手', exact: true }).click();
  const assistant = page.locator('.character-assistant-page');
  await assistant.getByRole('textbox', { name: '给角色助手发送消息' }).fill('讨论角色的创作方向');
  await assistant.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(assistant.locator('.assistant-message.from-assistant')).toHaveCount(1);
  const [temporary] = await apiRequest(page, '/api/character-assistant/sessions?unbound=true');
  await expect.poll(async () => (await apiRequest(page, `/api/character-assistant/sessions/${temporary.id}`)).messages.length).toBe(2);

  await assistant.getByRole('button', { name: '返回角色编辑', exact: true }).click();
  await expect(page).toHaveURL(/#\/characters\/new$/);
  await expect(page.locator('#character-name')).toHaveValue(roleName);
  await page.getByRole('button', { name: 'AI 完善助手', exact: true }).click();
  await expect(assistant.locator('.assistant-message.from-assistant')).toHaveCount(1);
  const afterReopen = await apiRequest(page, '/api/character-assistant/sessions?unbound=true');
  expect(afterReopen.map((item) => item.id)).toEqual([temporary.id]);

  await assistant.getByRole('button', { name: '返回角色编辑', exact: true }).click();
  await expect(page).toHaveURL(/#\/characters\/new$/);
  await page.reload();
  await expect(page.locator('#character-name')).toHaveValue(roleName);
  await page.getByRole('button', { name: /完整表单/ }).click();
  await page.locator('.character-editor-page').getByRole('button', { name: '保存角色', exact: true }).click();
  await expect(page).toHaveURL(/#\/characters\/(?!new\/)[^/]+\/edit$/);
  const characterId = /#\/characters\/([^/]+)\/edit$/.exec(page.url())[1];
  const bound = await apiRequest(page, `/api/character-assistant/sessions?characterId=${characterId}`);
  expect(bound.map((item) => item.id)).toEqual([temporary.id]);
  const boundDetail = await apiRequest(page, `/api/character-assistant/sessions/${temporary.id}`);
  expect(boundDetail.messages).toHaveLength(2);
  expect(boundDetail.messages[0].content).toBe('讨论角色的创作方向');
  await page.getByRole('button', { name: 'AI 完善助手', exact: true }).click();
  await expect(assistant.locator('.assistant-session-row')).toHaveCount(1);
  await expect(assistant.locator('.assistant-message.from-assistant')).toHaveCount(1);
});
