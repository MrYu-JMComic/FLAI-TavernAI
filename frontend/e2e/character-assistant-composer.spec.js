import { expect, test } from '@playwright/test';
import { apiRequest, registerUser } from './helpers.js';

async function openAssistant(page) {
  await registerUser(page);
  await page.goto('/#/characters/new/assistant');
  const composer = page.getByRole('textbox', { name: '给角色助手发送消息' });
  await expect(composer).toBeEnabled();
  return composer;
}

test('submitted text clears while a reply is pending and stays empty after reload', async ({ page }) => {
  const composer = await openAssistant(page);
  const requirement = '先讨论角色动机，不要修改草稿';
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/characters/complete-draft', async route => {
    await gate;
    await route.continue();
  });
  const request = page.waitForRequest('**/api/characters/complete-draft');
  await composer.fill(requirement);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  try {
    expect((await request).postDataJSON().requirement).toBe(requirement);
    await expect(composer).toHaveValue('');
    await expect(composer).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.locator('.assistant-message.from-assistant')).toContainText('当前使用本地 Mock');
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('');
  const sessions = await apiRequest(page, '/api/character-assistant/sessions?unbound=true');
  expect(sessions[0].state.requirement).toBe('');
  expect(sessions[0].messages[0].content).toBe(requirement);
  await page.reload();
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('');
});

test('a failed phone send retains text, and a successful Plan clears it without losing the task', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 368, height: 768 });
  const composer = await openAssistant(page);
  const requirement = '补充角色动机并规划修改步骤';
  await page.locator('.assistant-plan-toggle').click();
  await expect(page.locator('.assistant-plan-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.route('**/api/characters/complete-draft', route => route.fulfill({
    status: 503, json: { error: '模型暂不可用，请重试' }
  }), { times: 1 });
  await composer.fill(requirement);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.assistant-run-error')).toContainText('模型暂不可用');
  await expect(composer).toHaveValue(requirement);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const plan = page.getByRole('region', { name: 'AI 计划审批' });
  await expect(plan).toBeVisible();
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('');
  const sessions = await apiRequest(page, '/api/character-assistant/sessions?unbound=true');
  expect(sessions[0].state.requirement).toBe('');
  expect(sessions[0].state.planContext.requirement).toBe(requirement);
  await page.reload();
  await expect(plan).toBeVisible();
  await expect(composer).toHaveValue('');
  const replanning = page.waitForRequest('**/api/characters/complete-draft');
  await plan.getByRole('button', { name: '重新规划', exact: true }).click();
  const payload = (await replanning).postDataJSON();
  expect(payload.requirement).toBe(requirement);
  expect(payload.plan).toBeUndefined();
  expect(payload.planMode).toBe(true);
  await expect(composer).toBeEnabled();
  await expect(plan).toBeVisible();
  await expect(composer).toHaveValue('');
  await page.screenshot({ path: testInfo.outputPath('assistant-composer-after-send.png') });
});
