import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

async function createCharacter(page, suffix) {
  return apiRequest(page, '/api/characters', {
    method: 'POST',
    body: {
      name: `E2E NPC 角色 ${suffix}`,
      background: 'NPC panel E2E background.',
      worldview: 'Local-first NPC panel workspace.',
      persona: 'Stable test character for NPC panel coverage.',
      openingMessage: `NPC panel opening ${suffix}`,
      visibility: 'private'
    }
  });
}

async function createConversation(page, characterId) {
  return apiRequest(page, '/api/conversations', {
    method: 'POST',
    body: { characterId }
  });
}

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
      extraBody: '{}'
    }
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
      supportsReasoning: true
    }
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

test('opens the NPC management panel with seeded NPC profile, memory, and behavior', async ({ page }) => {
  const account = await registerUser(page);
  const suffix = account.suffix || uniqueSuffix();
  const character = await createCharacter(page, suffix);
  const conversation = await createConversation(page, character.id);
  const npcName = `守门人 ${suffix}`;
  const npcPathName = encodeURIComponent(npcName);
  const location = `钟楼 ${suffix}`;
  const alias = `夜巡者 ${suffix}`;
  const memoryText = `E2E 记忆 ${suffix}：在钟楼交还钥匙。`;
  const behaviorText = `E2E 行为 ${suffix}：听见钟声后提醒主角。`;

  await apiRequest(page, `/api/conversations/${conversation.id}/accessory-skills`, {
    method: 'PUT',
    body: {
      accessorySkills: {
        npcAgent: { enabled: true, modelOverride: '' }
      }
    }
  });
  await apiRequest(page, `/api/conversations/${conversation.id}/npcs/${npcPathName}`, {
    method: 'PUT',
    body: {
      status: 'active',
      currentLocation: location,
      aliases: [alias],
      memorySealed: false
    }
  });
  await apiRequest(page, `/api/conversations/${conversation.id}/npcs/${npcPathName}/memories`, {
    method: 'POST',
    body: {
      memoryType: 'event',
      content: memoryText
    }
  });
  await apiRequest(page, `/api/conversations/${conversation.id}/npcs/${npcPathName}/behaviors`, {
    method: 'POST',
    body: {
      behaviorType: 'reaction',
      triggerCondition: `钟声 ${suffix}`,
      action: behaviorText,
      priority: 42,
      enabled: true
    }
  });

  await page.goto(`/#/chat/${conversation.id}`);
  await expect(page.getByLabel('聊天消息输入')).toBeVisible();
  const npcButton = page.getByRole('button', { name: 'NPC 管理' });
  await expect(npcButton).toBeVisible();
  await npcButton.click();

  const panel = page.getByRole('dialog', { name: 'NPC 管理面板' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(npcName);
  await expect(panel).toContainText(location);
  await expect(panel).toContainText('1 记忆');
  await expect(panel).toContainText(memoryText);

  await panel.getByRole('button', { name: /行为/ }).click();
  await expect(panel).toContainText(behaviorText);

  await panel.getByRole('button', { name: '资料' }).click();
  await expect(panel.getByLabel('NPC 别名')).toHaveValue(alias);
});
