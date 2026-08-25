import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix, waitForThemeTransition } from './helpers.js';

test('loads saved provider settings and the provider capability registry', async ({ page }) => {
  const account = await registerUser(page);
  const suffix = account.suffix || uniqueSuffix();
  const gatewayName = `E2E Local Provider ${suffix}`;
  const baseUrl = await page.evaluate(() => `${window.location.origin}/api`);

  await apiRequest(page, '/api/settings/provider', {
    method: 'PUT',
    body: {
      providerType: 'custom',
      gatewayName,
      baseUrl,
      model: 'local-mock',
      supportsReasoning: true,
      extraBody: '{}',
    },
  });

  const capabilities = await apiRequest(page, '/api/providers/capabilities');
  expect(capabilities.providers.some((provider) => provider.providerType === 'custom')).toBe(true);

  const health = await apiRequest(page, '/api/providers/health', {
    method: 'POST',
    body: {
      providerType: 'custom',
      gatewayName,
      baseUrl,
      model: 'local-mock',
      supportsReasoning: true,
    },
  });
  expect(health.readiness.configured).toBe(true);
  expect(health.readiness.usable).toBe(true);
  expect(health.capability.providerType).toBe('custom');

  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'AI 供应商设置' })).toBeVisible();
  await expect(page.getByLabel('供应商')).toHaveValue('custom');
  await expect(page.getByLabel('网关名称')).toHaveValue(gatewayName);
  await expect(page.getByLabel('Base URL')).toHaveValue(baseUrl);
  await expect(page.getByLabel('模型')).toHaveValue('local-mock');

  const capabilityPanel = page.locator('.provider-capability-panel');
  await expect(capabilityPanel).toContainText('模型能力');
  await expect(capabilityPanel).toContainText('流式');
  await expect(capabilityPanel).toContainText('推理');
  await expect(capabilityPanel).toContainText('视觉');
});

test('NPC manager preserves the chat entry and supports the rebuilt desktop and mobile workflow', async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(12_000);
  const suffix = uniqueSuffix();
  const characterName = `人物面板角色 ${suffix}`;
  await registerUser(page, suffix);
  await createCharacterAndOpenChat(page, characterName);

  const conversationId = conversationIdFromUrl(page.url());
  const castBase = `/api/conversations/${encodeURIComponent(conversationId)}/cast`;
  const npc = await apiRequest(page, castBase, {
    method: 'POST',
    body: {
      canonicalName: `林澜 ${suffix}`,
      aliases: ['阿澜'],
      status: 'active',
      relationship: '可靠的向导',
      currentLocationLabel: '旧港口',
    },
  });
  await apiRequest(page, `${castBase}/${encodeURIComponent(npc.id)}/memories`, {
    method: 'POST',
    body: {
      content: '记得旧港口仓库的暗门。',
      memoryType: 'knowledge',
      layer: 'semantic',
      importance: 0.8,
    },
  });
  await apiRequest(page, `${castBase}/${encodeURIComponent(npc.id)}/behaviors`, {
    method: 'POST',
    body: {
      behaviorType: 'constraint',
      triggerCondition: '陌生人询问暗门',
      action: '先确认对方身份再回答',
      priority: 20,
      enabled: true,
    },
  });
  await apiRequest(page, `${castBase}/${encodeURIComponent(npc.id)}/items`, {
    method: 'POST',
    body: {
      name: '旧铜钥匙',
      description: '能够打开港口仓库侧门。',
      itemKind: 'key',
      quantity: 1,
      movable: true,
    },
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  const headerNpcButton = page.locator('.chat-header-primary-tool[aria-label="NPC 管理"]');
  await expect(headerNpcButton).toBeVisible();
  await headerNpcButton.click();

  const drawer = page.getByRole('dialog', { name: 'NPC 管理' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('NPC 管理', { exact: true })).toBeVisible();
  await expect(drawer.getByText(npc.canonicalName, { exact: true })).toBeVisible();
  await expect(drawer.getByText('记得旧港口仓库的暗门。')).not.toBeVisible();
  await drawer.getByRole('option', { name: new RegExp(npc.canonicalName) }).click();
  await expect(drawer.getByRole('heading', { name: npc.canonicalName })).toBeVisible();

  const locationInput = drawer.getByLabel('当前位置');
  await expect(locationInput).toHaveValue('旧港口');
  await locationInput.fill('钟楼广场');
  await drawer.getByRole('button', { name: '保存资料' }).click();
  await expect(locationInput).toHaveValue('钟楼广场');

  await drawer.getByRole('tab', { name: /记忆/ }).click();
  await expect(drawer.getByText('记得旧港口仓库的暗门。')).toBeVisible();
  await drawer.getByRole('button', { name: '添加记忆' }).click();
  await drawer.getByLabel('内容').fill('答应在钟楼敲响前带路。');
  await drawer.getByRole('button', { name: '保存记忆' }).click();
  await expect(drawer.getByText('答应在钟楼敲响前带路。')).toBeVisible();

  await drawer.getByRole('tab', { name: /行为/ }).click();
  await expect(drawer.getByText('先确认对方身份再回答')).toBeVisible();
  await drawer.getByRole('switch', { name: '停用行为规则' }).click();
  await expect(drawer.getByRole('switch', { name: '启用行为规则' })).toBeVisible();

  await drawer.getByRole('tab', { name: /物品/ }).click();
  await expect(drawer.getByText('旧铜钥匙', { exact: true })).toBeVisible();

  await drawer.getByRole('tab', { name: '审计' }).click();
  await expect(drawer.getByText('更新资料').first()).toBeVisible();
  const profileAudit = drawer.locator('.cast-audit-entry').filter({ hasText: '更新资料' }).first();
  await profileAudit.getByRole('button', { name: '回滚此变更' }).click();
  const confirmation = page.getByRole('alertdialog', { name: '回滚这次变更？' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '确认回滚' }).click();
  await expect(confirmation).toBeHidden();

  await drawer.getByRole('tab', { name: '资料' }).click();
  await expect(locationInput).toHaveValue('旧港口');
  await drawer.getByRole('tab', { name: '资料' }).press('ArrowRight');
  await expect(drawer.getByRole('tab', { name: /记忆/ })).toHaveAttribute('aria-selected', 'true');
  await drawer.getByRole('tab', { name: /记忆/ }).press('Home');
  await expect(drawer.getByRole('tab', { name: '资料' })).toHaveAttribute('aria-selected', 'true');

  const accessibility = await new AxeBuilder({ page }).include('.cast-manager-drawer').analyze();
  const seriousViolations = accessibility.violations.filter(({ impact }) => (
    impact === 'serious' || impact === 'critical'
  ));
  expect(seriousViolations).toEqual([]);
  await dismissNotifications(page);
  await page.screenshot({ path: '../.runtime-check/npc-refactor-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(drawer.locator('.cast-roster-pane')).toBeVisible();
  await expect(drawer.locator('.cast-detail-pane')).toBeVisible();
  await expectNoPageOrDrawerOverflow(page);
  await page.screenshot({ path: '../.runtime-check/npc-refactor-tablet.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });

  await drawer.getByRole('button', { name: '关闭 NPC 管理' }).click();
  await expect(drawer).toBeHidden();
  await expect(headerNpcButton).toBeFocused();

  await page.setViewportSize({ width: 375, height: 812 });
  const closeSidebarButton = page.getByRole('button', { name: '收起侧边栏' });
  if (await closeSidebarButton.isVisible()) await closeSidebarButton.click();
  await page.getByLabel('更多聊天工具').click();
  await page.getByRole('menuitem', { name: 'NPC 管理' }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('option', { name: new RegExp(npc.canonicalName) })).toBeVisible();
  await drawer.getByRole('option', { name: new RegExp(npc.canonicalName) }).click();
  await expect(drawer.getByRole('button', { name: '人物列表' })).toBeVisible();

  await drawer.getByLabel('更多 NPC 管理操作').click();
  const mobileMenu = drawer.locator('.cast-mobile-actions-menu');
  await expect(mobileMenu.getByText('自动同步', { exact: true })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: '全局整理' })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: '隐藏空记录' })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: '刷新资料' })).toBeVisible();
  await drawer.getByLabel('更多 NPC 管理操作').click();
  await expect(mobileMenu).toBeHidden();

  await expectNoPageOrDrawerOverflow(page);
  await page.screenshot({ path: '../.runtime-check/npc-refactor-mobile.png', fullPage: true });

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await waitForThemeTransition(page);
  const darkAccessibility = await new AxeBuilder({ page }).include('.cast-manager-drawer').analyze();
  expect(darkAccessibility.violations.filter(({ impact }) => (
    impact === 'serious' || impact === 'critical'
  ))).toEqual([]);
  await page.screenshot({ path: '../.runtime-check/npc-refactor-dark.png', fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await waitForThemeTransition(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(drawer.locator('.cast-roster-pane')).toBeVisible();
  await expect(drawer.locator('.cast-detail-pane')).toBeVisible();
  await expectNoPageOrDrawerOverflow(page);
  await expectUsableDrawerContent(drawer);
  await page.screenshot({ path: '../.runtime-check/npc-refactor-landscape.png', fullPage: true });
});

async function createCharacterAndOpenChat(page, characterName) {
  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await expect(page.getByRole('heading', { name: /创建新的 AI 角色/ })).toBeVisible();
  await page.getByRole('button', { name: /完整表单/ }).click();
  await page.getByLabel('角色名').fill(characterName);
  await page.getByLabel('角色背景内容').fill('用于 NPC 管理重构验收。');
  await page.getByLabel('角色世界观内容').fill('一座由旧港与钟楼组成的城市。');
  await page.getByLabel('角色人设内容').fill('谨慎、可靠、重视事实。');
  await page.getByLabel('角色开场白内容').fill('钟楼的钟声刚刚响起。');
  await page.getByRole('button', { name: /保存角色/ }).click();
  await expect(page).toHaveURL(/#\/characters\/[^/]+\/edit/, { timeout: 15_000 });
  await page.getByRole('button', { name: /^返回$/ }).click();
  const characterCard = page.locator('.home-character-card').filter({ hasText: characterName }).first();
  await expect(characterCard).toBeVisible();
  await characterCard.getByRole('button', { name: /对话/ }).click();
  await expect(page).toHaveURL(/#\/chat\/[^/]+/, { timeout: 15_000 });
  await expect(page.getByLabel('聊天消息输入')).toBeVisible();
}

function conversationIdFromUrl(url) {
  const match = String(url).match(/#\/chat\/([^/?#]+)/);
  if (!match) throw new Error(`Unable to read conversation id from ${url}`);
  return decodeURIComponent(match[1]);
}

async function dismissNotifications(page) {
  const closeButtons = page.locator('.message-toast-close');
  await closeButtons.evaluateAll((buttons) => {
    for (const button of buttons) button.click();
  });
  await expect(page.locator('.message-toast')).toHaveCount(0);
}

async function expectNoPageOrDrawerOverflow(page) {
  const overflow = await page.evaluate(() => {
    const drawer = document.querySelector('.cast-manager-drawer');
    return {
      document: document.documentElement.scrollWidth - window.innerWidth,
      drawer: drawer ? drawer.scrollWidth - drawer.clientWidth : 1,
    };
  });
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.drawer).toBeLessThanOrEqual(0);
}

async function expectUsableDrawerContent(drawer) {
  const contentHeight = await drawer.locator('.cast-tab-content').evaluate((element) => (
    element.getBoundingClientRect().height
  ));
  expect(contentHeight).toBeGreaterThanOrEqual(120);
}
