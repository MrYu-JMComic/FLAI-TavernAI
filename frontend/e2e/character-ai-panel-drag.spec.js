import { expect, test } from '@playwright/test';
import { registerUser, uniqueSuffix } from './helpers.js';

test('AI draft workspace stays inline and usable across desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await registerUser(page, uniqueSuffix());

  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await expect(page.getByRole('heading', { name: /创建新的 AI 角色/ })).toBeVisible();
  await page.getByRole('button', { name: /完整表单/ }).click();
  // The full form keeps every section available; focus the AI section in the directory.
  await page.locator('.character-studio-nav').getByRole('button', { name: /AI 完善/ }).click();

  const panel = page.locator('.ai-draft-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.ai-workbench-header')).toBeVisible();
  await expect(panel.locator('.ai-workbench-config')).toBeVisible();
  await expect(panel.locator('.ai-workbench-results')).toBeVisible();
  await expect(panel.getByText('实时运行台', { exact: true })).toBeVisible();
  await expect(panel.getByText('思考强度', { exact: true })).toBeVisible();
  // Both run switches share a single frame instead of stacking bordered cards.
  await expect(panel.locator('.ai-option-stack > .ai-option-row')).toHaveCount(2);
  await expect(panel.locator('.ai-scope-chip')).toHaveCount(11);
  const streamingToggle = panel.locator('.ai-stream-toggle input');
  const scopeDisclosure = panel.locator('.ai-scope-disclosure');
  await expect(streamingToggle).not.toBeChecked();
  await panel.locator('.ai-stream-toggle').click();
  await expect(streamingToggle).toBeChecked();
  await expect(panel.locator('.ai-stream-card')).toHaveClass(/is-active/);
  await expect(scopeDisclosure).not.toHaveAttribute('open', '');
  await scopeDisclosure.locator('summary').click();
  await expect(scopeDisclosure).toHaveAttribute('open', '');
  await scopeDisclosure.locator('summary').click();
  await expect(scopeDisclosure).not.toHaveAttribute('open', '');
  await expect(panel.locator('.ai-panel-heading, .ai-panel-resize-handle')).toHaveCount(0);

  const desktopLayout = await panel.evaluate((element) => ({
    parentClass: element.parentElement?.className || '',
    position: getComputedStyle(element).position,
    overflow: element.scrollWidth - element.clientWidth,
    documentOverflow: document.documentElement.scrollWidth - window.innerWidth
  }));
  expect(desktopLayout.parentClass).toContain('character-studio-stage');
  expect(desktopLayout.position).toBe('relative');
  expect(desktopLayout.overflow).toBeLessThanOrEqual(1);
  expect(desktopLayout.documentOverflow).toBeLessThanOrEqual(0);

  // On phones the same panel is rendered by the mobile shell's section sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.character-mobile-section-item[data-section-id="ai"]').click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCount(1);
  await expect(panel.getByRole('button', { name: '开始完善' })).toBeVisible();
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await panel.getByLabel('完善要求').fill('保留当前草稿并检查结构');
  await panel.getByRole('button', { name: '开始完善' }).click();
  await expect(panel.locator('.ai-workbench-status')).toContainText('已完成');
  await expect(panel.locator('.ai-process-summary')).toContainText('本地 Mock 已验证当前草稿');
  await expect(panel.locator('.ai-monitor-counters')).toContainText('1 调用');
  await expect(panel.locator('.ai-process-step-head')).toContainText('完成结构验收');
  await expect(panel.locator('.ai-process-header')).toContainText('1 完成 / 1 调用');
  await expect(panel.locator('.ai-run-warnings')).toContainText('当前使用本地 Mock，未调用真实模型。');
  // The run counters must read as one line, not two stacked pills.
  const counterRows = await panel.locator('.ai-monitor-counters span').evaluateAll(
    (nodes) => new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top))).size
  );
  expect(counterRows).toBe(1);
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
