import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('chat model picker searches models and saves only after confirmation', async ({ page }) => {
  const suffix = uniqueSuffix();
  await registerUser(page, suffix);
  let currentModel = 'picker-current';
  let activeProviderId = 'global-profile';
  let savedModelPayload = null;
  const provider = {
    id: 'global-profile',
    providerType: 'custom',
    gatewayName: `Chat picker ${suffix}`,
    baseUrl: `https://chat-picker-${suffix}.example/v1`,
    model: 'picker-current',
    supportsReasoning: true,
    extraBody: '{}'
  };
  const alternateProvider = {
    id: 'claude-profile',
    providerType: 'anthropic',
    gatewayName: `Claude picker ${suffix}`,
    baseUrl: `https://claude-picker-${suffix}.example/v1`,
    model: 'claude-current',
    supportsReasoning: true,
    extraBody: '{}'
  };
  const models = [{ id: 'picker-current' }, { id: 'picker-next' }, { id: 'other-model' }];
  const alternateModels = [{ id: 'claude-current' }, { id: 'claude-next' }];
  const modelCacheKey = [
    provider.providerType,
    provider.gatewayName.trim().toLowerCase(),
    provider.baseUrl.replace(/\/+$/, '').toLowerCase(),
    'false',
    String(Boolean(provider.supportsReasoning)),
    '{}'
  ].join('|');

  const activeProvider = () => activeProviderId === alternateProvider.id ? alternateProvider : provider;
  const providerBundle = () => ({
    providers: [provider, alternateProvider].map((profile) => ({
      ...profile,
      model: profile.id === activeProviderId ? currentModel : profile.model,
      selected: profile.id === activeProviderId
    })),
    selectedProviderId: activeProviderId
  });
  await page.route('**/api/settings/provider', async (route) => {
    if (route.request().method() === 'PUT') {
      savedModelPayload = route.request().postDataJSON();
      currentModel = savedModelPayload?.model || '';
    }
    await route.fulfill({ json: { ...activeProvider(), model: currentModel } });
  });
  await page.route('**/api/providers', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: providerBundle() });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/providers/*/select', async (route) => {
    activeProviderId = new URL(route.request().url()).pathname.split('/').at(-2);
    currentModel = activeProvider().model;
    await route.fulfill({ json: providerBundle() });
  });
  await page.route('**/api/providers/models', async (route) => {
    const body = route.request().postDataJSON() || {};
    await route.fulfill({
      json: { models: body.providerId === alternateProvider.id ? alternateModels : models }
    });
  });
  await page.addInitScript(({ key, cachedModels }) => {
    localStorage.setItem(`flai-provider-models:v1:${encodeURIComponent(key)}`, JSON.stringify({
      savedAt: Date.now(),
      models: cachedModels
    }));
  }, { key: modelCacheKey, cachedModels: models });

  await page.reload();

  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: { name: `Model picker ${suffix}`, openingMessage: 'Ready.' }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST',
    body: { characterId: character.id }
  });
  await page.goto(`/#/chat/${conversation.id}`);

  const trigger = page.getByRole('button', { name: '快速切换聊天模型', exact: true });
  await page.setViewportSize({ width: 390, height: 240 });
  await expect(trigger).toBeVisible();
  await expect(trigger.locator('.model-switch-name')).toBeVisible();
  await expect(trigger.locator('.model-switch-name')).toHaveText('picker-current');
  await expect(page.getByRole('combobox', { name: '快速切换聊天模型' })).toHaveCount(0);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '切换聊天模型' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('3 个选项')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'picker-current' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: '关闭模型切换器' })).toBeFocused();
  const shell = dialog.locator('.chat-model-switcher-shell');
  expect(await shell.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const saveButton = dialog.getByRole('button', { name: '切换模型' });
  await saveButton.scrollIntoViewIfNeeded();
  expect(await saveButton.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  })).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 1280, height: 720 });
  await trigger.click();
  await expect(dialog.getByRole('searchbox', { name: '搜索当前网关模型' })).toBeFocused();
  await dialog.getByRole('button', { name: '刷新模型列表' }).click();
  await expect(dialog.getByText('3 个选项')).toBeVisible();
  const search = dialog.getByRole('searchbox', { name: '搜索当前网关模型' });
  await search.fill('picker-next');
  await expect(dialog.getByRole('button', { name: /picker-next/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /other-model/ })).toHaveCount(0);

  const claudeGateway = dialog.getByRole('button', { name: alternateProvider.gatewayName, exact: true });
  await expect(claudeGateway).toBeVisible();
  await claudeGateway.click();
  await expect(claudeGateway).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('2 个选项')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'claude-current' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: /picker-next/ })).toHaveCount(0);

  await dialog.getByRole('button', { name: /claude-next/ }).click();
  await expect(dialog.getByRole('button', { name: '切换模型' })).toBeEnabled();
  await expect(dialog.locator('.chat-model-option[aria-pressed="true"]')).toContainText('claude-next');
  await search.fill('');
  await expect(dialog.getByRole('button', { name: 'claude-current' })).toHaveAttribute('aria-pressed', 'false');
  expect(currentModel).toBe('claude-current');

  await dialog.getByRole('button', { name: '切换模型' }).click();
  await expect(dialog).not.toBeVisible();
  expect(currentModel).toBe('claude-next');
  expect(savedModelPayload).toMatchObject({
    providerType: 'anthropic',
    gatewayName: alternateProvider.gatewayName,
    baseUrl: alternateProvider.baseUrl,
    model: 'claude-next'
  });
  await expect(trigger).toBeFocused();
  await expect(trigger.locator('.model-switch-name')).toHaveText('claude-next');
});
