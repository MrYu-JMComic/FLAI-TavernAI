import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

const runtimeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.runtime-check');

test('real context quality workflow preserves rejected drafts and reviews traces and memories', async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = uniqueSuffix();
  await registerUser(page, suffix);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Context live ${suffix}`, persona: 'Keeps deterministic story continuity.' }
  });
  const conversation = await apiRequest(page, '/api/conversations', { method: 'POST', body: { characterId: character.id } });
  const memoryBase = `/api/conversations/${conversation.id}/memories`;
  const firstMemory = await apiRequest(page, memoryBase, {
    method: 'POST', body: { memoryType: 'relationship', subject: 'Mira', content: 'Mira trusts Rowan.', sourceKind: 'auto', enabled: false }
  });
  const secondMemory = await apiRequest(page, memoryBase, {
    method: 'POST', body: { memoryType: 'relationship', subject: 'Mira', content: 'Mira distrusts Rowan.', sourceKind: 'auto', enabled: false }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/chat/${conversation.id}`);
  await expect(page.locator('.deep-chat-main')).toBeVisible();
  let inspector = await openInspector(page);
  await inspector.getByRole('tab', { name: '预算' }).click();
  const budget = inspector.getByRole('region', { name: '上下文预算设置' });
  await expect(budget).toHaveAttribute('aria-busy', 'false');
  await budget.getByLabel('输入 Token 上限').fill('32');
  await budget.getByLabel('预留输出 Token').fill('128');
  await budget.getByRole('button', { name: '保存' }).click();
  await expect(budget).toHaveAttribute('aria-busy', 'false');
  await expect(budget.getByLabel('输入 Token 上限')).toHaveValue('32');
  await inspector.getByRole('button', { name: '关闭上下文检查器' }).click();

  const beforeRejectedMessages = await apiRequest(page, `/api/conversations/${conversation.id}/messages`);
  const beforeRejectedCount = beforeRejectedMessages.messages.length;
  const rejectedDraft = `预算拒绝后必须完整保留的草稿 ${'月影港'.repeat(260)}`;
  const composer = page.getByLabel('聊天消息输入');
  await composer.fill(rejectedDraft);
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(composer).toHaveValue(rejectedDraft);
  await expect(page.getByText(/上下文.*预算|输入预算/).last()).toBeVisible();
  const afterRejectedMessages = await apiRequest(page, `/api/conversations/${conversation.id}/messages`);
  expect(afterRejectedMessages.messages).toHaveLength(beforeRejectedCount);

  inspector = await openInspector(page);
  await inspector.getByRole('tab', { name: '预算' }).click();
  await expect(inspector.getByRole('region', { name: '上下文预算设置' })).toHaveAttribute('aria-busy', 'false');
  await inspector.getByRole('region', { name: '上下文预算设置' }).getByLabel('输入 Token 上限').fill('8000');
  await inspector.getByRole('region', { name: '上下文预算设置' }).getByRole('button', { name: '保存' }).click();
  await expect(inspector.getByRole('region', { name: '上下文预算设置' })).toHaveAttribute('aria-busy', 'false');
  await inspector.getByRole('button', { name: '关闭上下文检查器' }).click();
  await composer.fill(`real mock trace ${suffix}`);
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText(/本地 Mock 回复/).last()).toBeVisible({ timeout: 30_000 });

  inspector = await openInspector(page);
  await inspector.getByRole('tab', { name: '实际请求' }).click();
  const history = inspector.getByRole('region', { name: '实际请求历史' });
  await expect(history.getByText(/0 次传输/)).toBeVisible();
  await history.locator('li button').first().click();
  await expect(history.getByText('生成状态：completed')).toBeVisible();
  await expect(history.getByText(/未记录线上传输.*mock/)).toBeVisible();
  await expect(history.getByText('敏感字段已脱敏')).toBeVisible();
  await assertNoHorizontalOverflow(page, inspector);
  await page.screenshot({ path: path.join(runtimeDir, 'stage4-context-desktop.png'), animations: 'disabled' });

  await inspector.getByRole('tab', { name: '记忆' }).click();
  const memoryReview = inspector.getByRole('region', { name: '对话记忆审阅' });
  await expect(memoryReview.getByText(firstMemory.content, { exact: true })).toBeVisible();
  await expect(memoryReview.getByText(secondMemory.content, { exact: true })).toBeVisible();
  await memoryReview.getByRole('checkbox', { name: /选择记忆：Mira/ }).nth(0).check();
  await memoryReview.getByRole('checkbox', { name: /选择记忆：Mira/ }).nth(1).check();
  await memoryReview.getByRole('toolbar', { name: '批量记忆操作' }).getByRole('button', { name: '确认' }).click();
  await expect(memoryReview.getByText('待审阅候选 1 组')).toBeVisible();
  await memoryReview.getByRole('button', { name: '置顶记忆' }).first().click();
  await memoryReview.locator('summary').filter({ hasText: '待审阅候选' }).click();
  await memoryReview.getByRole('button', { name: '审阅合并' }).click();
  const mergeDialog = page.getByRole('form', { name: '合并记忆' });
  await expect(mergeDialog).toBeVisible();
  await mergeDialog.getByRole('button', { name: '合并' }).click();
  await expect(memoryReview.getByRole('button', { name: '撤销上次合并' })).toBeVisible();
  await memoryReview.getByRole('button', { name: '撤销上次合并' }).click();
  await expect(memoryReview.getByText(firstMemory.content, { exact: true })).toBeVisible();
  await expect(memoryReview.getByText(secondMemory.content, { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await inspector.getByRole('tab', { name: '预算' }).click();
  await expect(inspector.getByRole('region', { name: '上下文预算设置' })).toBeVisible();
  await inspector.getByRole('tab', { name: '实际请求' }).click();
  await expect(history).toBeVisible();
  await inspector.getByRole('tab', { name: '记忆' }).click();
  await assertNoHorizontalOverflow(page, inspector);
  await page.screenshot({ path: path.join(runtimeDir, 'stage4-context-mobile.png'), animations: 'disabled' });

  const memoryTab = inspector.getByRole('tab', { name: '记忆' });
  await memoryTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(inspector.getByRole('tab', { name: '实际请求' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(inspector.getByRole('tab', { name: '预算' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(inspector.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(inspector.getByRole('tab', { name: '预算' })).toHaveAttribute('aria-selected', 'true');

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(inspector.getByRole('tab')).toHaveCount(4);
  await expect(inspector.getByRole('region', { name: '上下文预算设置' })).toBeVisible();
  await assertNoHorizontalOverflow(page, inspector);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await inspector.getByRole('tab', { name: '实际请求' }).click();
  await expect(history).toBeVisible();
  await assertNoHorizontalOverflow(page, inspector);
  await page.screenshot({ path: path.join(runtimeDir, 'stage4-context-mobile-dark.png'), animations: 'disabled' });

  await page.setViewportSize({ width: 844, height: 390 });
  await inspector.getByRole('tab', { name: '记忆' }).click();
  await expect(memoryReview).toBeVisible();
  await assertNoHorizontalOverflow(page, inspector);
});

async function openInspector(page) {
  await page.getByLabel('更多聊天工具', { exact: true }).click();
  await page.getByRole('menuitem', { name: '上下文检查器' }).click();
  const inspector = page.getByRole('dialog', { name: 'Prompt Pipeline V2' });
  await expect(inspector).toBeVisible();
  return inspector;
}

async function assertNoHorizontalOverflow(page, inspector) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(await inspector.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const box = await inspector.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}
