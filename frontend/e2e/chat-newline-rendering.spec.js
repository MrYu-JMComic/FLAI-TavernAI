import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('renders Markdown soft breaks and paragraph spacing consistently on desktop and mobile', async ({ page }, testInfo) => {
  await registerUser(page);
  const suffix = uniqueSuffix();
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Newline ${suffix}` }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST', body: { characterId: character.id }
  });
  const payload = await apiRequest(page, `/api/conversations/${conversation.id}/messages`);
  const messageId = `newline-${suffix}`;
  const messages = [{
    id: messageId,
    role: 'assistant',
    reasoning: '',
    content: [
      '第一段的第一行\\n第一段的第二行\\\\n\\\\n第二段文字',
      '',
      '内联代码：`code\\nline`',
      '',
      '```text',
      '代码\\n内容',
      '```'
    ].join('\n'),
    createdAt: new Date().toISOString()
  }];

  await page.route(`**/api/conversations/${conversation.id}/messages`, (route) => (
    route.fulfill({ json: { ...payload, messages } })
  ));
  await page.route('**/api/messages/*/swipes', (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/conversations/${conversation.id}/branches`, (route) => route.fulfill({ json: [] }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/chat/${conversation.id}`);

  const bubble = page.locator(`.deep-message[data-message-id="${messageId}"] .deep-bubble`);
  const paragraphs = bubble.locator('.markdown-content > p');
  await expect(paragraphs).toHaveCount(3);
  await expect(paragraphs.nth(0).locator('br')).toHaveCount(1);
  await expect.poll(() => paragraphs.nth(0).evaluate((paragraph) => paragraph.textContent.replace(/\s+/g, '')))
    .toBe('第一段的第一行第一段的第二行');
  await expect(paragraphs.nth(1)).toHaveText('第二段文字');
  await expect(paragraphs.nth(2).locator('code')).toHaveText(String.raw`code\nline`);
  await expect(bubble.locator('pre code')).toContainText(String.raw`代码\n内容`);
  const paragraphLayout = await paragraphs.nth(1).evaluate((second) => {
    const first = second.previousElementSibling;
    return {
      whiteSpace: getComputedStyle(first).whiteSpace,
      gap: second.getBoundingClientRect().top - first.getBoundingClientRect().bottom
    };
  });
  expect(paragraphLayout.whiteSpace).toBe('normal');
  expect(paragraphLayout.gap).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('chat-newlines-desktop.png'), animations: 'disabled' });

  await page.setViewportSize({ width: 390, height: 844 });
  const closeSidebar = page.getByRole('button', { name: '收起侧边栏' });
  if (await closeSidebar.isVisible()) await closeSidebar.click();
  await expect(bubble).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('chat-newlines-mobile.png'), animations: 'disabled' });
});
