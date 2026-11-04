import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

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
  await page.getByRole('button', { name: '模型网关', exact: true }).click();
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

