import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('mobile HTTP copy uses the user-gesture fallback when Clipboard API is unavailable', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      get: () => undefined
    });
    const originalExecCommand = Document.prototype.execCommand;
    Document.prototype.execCommand = function execCommand(command, ...args) {
      if (command === 'copy') {
        window.__lanCopyFallbackUsed = true;
        return true;
      }
      return typeof originalExecCommand === 'function'
        ? originalExecCommand.call(this, command, ...args)
        : false;
    };
  });

  await registerUser(page, uniqueSuffix());
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST',
    body: { name: `LAN Copy ${uniqueSuffix()}` }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST',
    body: { characterId: character.id }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/chat/${conversation.id}`);
  const input = page.getByLabel('聊天消息输入');
  await input.fill('手机局域网复制回归');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('手机局域网复制回归', { exact: true })).toBeVisible();
  await expect(page.getByText(/本地 Mock 回复/)).toBeVisible({ timeout: 30_000 });

  await page.locator('button[title="复制消息"]').last().click();
  await expect.poll(() => page.evaluate(() => window.__lanCopyFallbackUsed === true)).toBe(true);
});
