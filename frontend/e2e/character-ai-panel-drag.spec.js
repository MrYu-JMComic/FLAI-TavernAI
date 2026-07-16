import { expect, test } from '@playwright/test';
import { registerUser, uniqueSuffix } from './helpers.js';

test('desktop AI draft panel can move vertically', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await registerUser(page, uniqueSuffix());

  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await expect(page.getByRole('heading', { name: /创建新的 AI 角色/ })).toBeVisible();
  await page.getByRole('button', { name: /完整表单/ }).click();

  const panel = page.locator('.ai-draft-panel');
  const handle = panel.locator('.ai-panel-heading');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '重置 AI 完善面板位置' }).click();
  await page.waitForTimeout(120);
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  const initialBox = await panel.boundingBox();
  const initialHandleBox = await handle.boundingBox();
  expect(initialBox).not.toBeNull();
  expect(initialHandleBox).not.toBeNull();

  await startDragFromCenter(page, initialHandleBox, 0, 60);
  await expect(panel).toHaveClass(/ai-panel-dragging/);
  await page.mouse.up();
  const movedDownBox = await panel.boundingBox();
  expect(movedDownBox.y).toBeGreaterThan(initialBox.y + 20);

  const movedHandleBox = await handle.boundingBox();
  expect(movedHandleBox).not.toBeNull();
  await startDragFromCenter(page, movedHandleBox, 0, -45);
  await page.mouse.up();
  const movedUpBox = await panel.boundingBox();
  expect(movedUpBox.y).toBeLessThan(movedDownBox.y - 20);
});

async function startDragFromCenter(page, box, deltaX, deltaY) {
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
}
