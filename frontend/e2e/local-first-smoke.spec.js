import { expect, test } from '@playwright/test';
import { registerUser, uniqueSuffix } from './helpers.js';

test('registers, creates a character, opens chat, and receives a local mock reply', async ({ page }) => {
  const suffix = uniqueSuffix();
  const account = await registerUser(page, suffix);
  const characterName = `E2E 角色 ${suffix}`;
  const openingMessage = `你好，${account.username}，这里是 E2E 开场白。`;
  const userMessage = `E2E smoke message ${suffix}`;

  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await expect(page.getByRole('heading', { name: /创建新的 AI 角色/ })).toBeVisible();
  await page.getByRole('button', { name: /完整表单/ }).click();

  await page.getByLabel('角色名').fill(characterName);
  await page.getByLabel('角色背景内容').fill('用于端到端烟测的背景。');
  await page.getByLabel('角色世界观内容').fill('本地优先工作台内的测试世界。');
  await page.getByLabel('角色人设内容').fill('稳定、可重复、不会访问外部模型。');
  await page.getByLabel('角色开场白内容').fill(openingMessage);
  await page.getByRole('button', { name: /保存角色/ }).click();
  await expect(page).toHaveURL(/#\/characters\/[^/]+\/edit/, { timeout: 15_000 });

  await page.getByRole('button', { name: /^返回$/ }).click();
  await expect(page.getByRole('heading', { name: '角色库' })).toBeVisible();
  const characterCard = page.locator('.home-character-card').filter({ hasText: characterName }).first();
  await expect(characterCard).toBeVisible();
  await characterCard.getByRole('button', { name: /对话/ }).click();

  await expect(page).toHaveURL(/#\/chat\/[^/]+/, { timeout: 15_000 });
  await expect(page.getByLabel('聊天消息输入')).toBeVisible();
  await expect(page.getByText(openingMessage)).toBeVisible();

  await page.getByLabel('聊天消息输入').fill(userMessage);
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText(userMessage)).toBeVisible();
  await expect(page.getByText(/本地 Mock 回复/)).toBeVisible({ timeout: 30_000 });
});
