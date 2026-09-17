import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('context inspector separates preview, actual requests, memory review, and model budget', async ({ page }) => {
  await registerUser(page);
  const character = await apiRequest(page, '/api/characters', { method: 'POST', body: { name: `Context ${uniqueSuffix()}` } });
  const conversation = await apiRequest(page, '/api/conversations', { method: 'POST', body: { characterId: character.id } });
  let savedBudget = null;
  await page.route(`**/api/conversations/${conversation.id}/context/budget`, async (route) => {
    if (route.request().method() === 'PUT') savedBudget = route.request().postDataJSON();
    const config = savedBudget || { inputTokenLimit: 12000, reservedOutputTokens: 2000, imageTokensPerImage: 800 };
    await route.fulfill({ json: {
      config,
      resolved: { inputTokenLimit: config.inputTokenLimit, reservedOutputTokens: config.reservedOutputTokens, imageTokensPerImage: config.imageTokensPerImage, contextWindowTokens: 16000, effectiveInputLimit: 12000, warning: '', estimated: true, exact: false },
      provider: { providerType: 'openai', model: 'contract-model' }
    } });
  });
  await page.route(`**/api/conversations/${conversation.id}/context/traces`, (route) => route.fulfill({ json: { traces: [{
    id: 'trace-1', operation: 'send', providerType: 'openai', model: 'contract-model', status: 'completed',
    sourceMessageId: 'user-1', assistantMessageId: 'assistant-1', timelineRevision: 2,
    createdAt: '2026-09-06T00:00:00.000Z', finishedAt: '2026-09-06T00:00:01.000Z', errorCode: '', requestCount: 1
  }] } }));
  await page.route(`**/api/conversations/${conversation.id}/context/traces/trace-1`, (route) => route.fulfill({ json: {
    id: 'trace-1', operation: 'send', providerType: 'openai', model: 'contract-model', status: 'completed', outdated: true, redacted: true,
    createdAt: '2026-09-06T00:00:00.000Z', finishedAt: '2026-09-06T00:00:01.000Z', requestCount: 1,
    logicalMessages: [{ role: 'user', content: 'hello' }], selection: { sources: {} }, budget: { estimatedTokens: 42, exact: false },
    requests: [{ id: 'request-1', ordinal: 1, method: 'POST', host: 'api.example.test', endpoint: '/responses', body: { truncated: true, originalCharacters: 300000, preview: '[redacted]' }, redactions: [{ path: 'api_key', reason: 'secret_field' }], tokenEstimate: { estimatedTokens: 42 }, status: 'completed', httpStatus: 200, errorCode: '' }]
  } }));

  await page.goto(`/#/chat/${conversation.id}`);
  await expect(page.locator('.deep-chat-main')).toBeVisible();
  await page.getByLabel('更多聊天工具', { exact: true }).click();
  await page.getByRole('menuitem', { name: '上下文检查器' }).click();
  const inspector = page.getByRole('dialog', { name: 'Prompt Pipeline V2' });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('tab')).toHaveCount(4);

  await inspector.getByRole('tab', { name: '记忆' }).click();
  await expect(inspector.getByRole('region', { name: '对话记忆审阅' })).toBeVisible();

  await inspector.getByRole('tab', { name: '预算' }).click();
  const budget = inspector.getByRole('region', { name: '上下文预算设置' });
  await expect(budget).toHaveAttribute('aria-busy', 'false');
  await expect(budget.getByText('估算值 · 非精确计数')).toBeVisible();
  await budget.getByLabel('预留输出 Token').fill('2500');
  await budget.getByRole('button', { name: '保存' }).click();
  await expect.poll(() => savedBudget?.reservedOutputTokens).toBe(2500);

  await inspector.getByRole('tab', { name: '实际请求' }).click();
  await inspector.getByRole('button', { name: /send · completed/ }).click();
  await expect(inspector.getByText(/2026.*1 次传输/)).toBeVisible();
  await expect(inspector.getByText('生成状态：completed')).toBeVisible();
  await expect(inspector.getByText('传输 1 · HTTP 200')).toBeVisible();
  await expect(inspector.getByText('尝试 1 · 重定向 0 · 鉴权 未记录')).toBeVisible();
  await expect(inspector.getByText('估算 Token 42 · 完整构建上下文 · constructed-request')).toBeVisible();
  await expect(inspector.getByText('请求 JSON 已截断，原始字符 300000')).toBeVisible();
  await expect(inspector.getByText(/敏感字段已脱敏/)).toBeVisible();
  await expect(inspector.getByText(/secret_field/)).toBeVisible();
});
