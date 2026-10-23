import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('assistant activity follows the agent timeline and keeps the final answer last', async ({ page }, testInfo) => {
  await registerUser(page);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Workflow ${uniqueSuffix()}`, persona: 'A careful character editor.' }
  });
  const session = await apiRequest(page, '/api/character-assistant/sessions', {
    method: 'POST', body: { characterId: character.id, character, title: '工作流验证' }
  });
  const tools = [
    { name: 'read_character_field', arguments: { field: 'persona' }, result: { ok: true, totalLength: 18 } },
    { name: 'search_character_draft', arguments: { query: '状态栏' }, result: { ok: true, matches: [{ start: 12 }] } },
    { name: 'update_status_bar_code', arguments: { section: 'template' }, result: { ok: true, count: 1 } }
  ];
  const messages = [
    { id: 'user-workflow', role: 'user', content: '优化状态栏并核对变量。', status: 'completed' },
    {
      id: 'assistant-workflow', role: 'assistant', status: 'completed',
      content: '完成：模板已更新并通过字段核验。',
      process: [
        {
          round: 1,
          content: '我先检查状态栏变量与模板位置。',
          activity: [
            { type: 'content', text: '我先检查状态栏变量与模板位置。' },
            { type: 'tool', index: 0 },
            { type: 'tool', index: 1 }
          ],
          tools: tools.slice(0, 2)
        },
        {
          round: 2,
          content: '模板已更新。完成：模板已更新并通过字段核验。',
          activity: [
            { type: 'content', text: '模板已更新。完成：模板已更新并通过字段核验。' },
            { type: 'tool', index: 0 }
          ],
          tools: [tools[2]]
        }
      ],
      toolCalls: tools
    }
  ];
  await page.route(`**/api/character-assistant/sessions/${session.id}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ json: { ...session, messages, state: { ...session.state, status: 'completed' } } });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/characters/${character.id}/assistant`);
  await expect(page.getByRole('textbox', { name: '给角色助手发送消息' })).toBeEnabled();
  const assistant = page.locator('.assistant-message.from-assistant').last();
  const timeline = assistant.locator('.ai-workflow-timeline');
  await expect(timeline).toBeVisible();
  await expect(timeline.locator('.ai-workflow-assistant-message')).toHaveCount(2);
  await expect(timeline.locator('.ai-workflow-tool-batch')).toHaveCount(1);
  await expect(timeline.locator('.ai-workflow-tool-item')).toHaveCount(3);
  await expect(timeline).not.toContainText('完成：模板已更新并通过字段核验。');
  await expect(assistant.locator('.assistant-message-content').last()).toContainText('完成：模板已更新并通过字段核验。');
  await expect(timeline.locator('.ai-workflow-tool-batch > summary')).toContainText('2 项完成');
  await expect(timeline.locator('.ai-workflow-tool-batch')).not.toHaveAttribute('open', '');
  await page.evaluate(async () => {
    for (let index = 0; index < 4; index++) await new Promise(resolve => requestAnimationFrame(resolve));
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('assistant-workflow-desktop.png'), animations: 'disabled' });

  await page.setViewportSize({ width: 364, height: 725 });
  await page.evaluate(async () => {
    for (let index = 0; index < 3; index++) await new Promise(resolve => requestAnimationFrame(resolve));
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect.poll(() => timeline.evaluate(element => {
    const style = getComputedStyle(element);
    return style.maxHeight === 'none' && style.overflowY === 'visible' && element.scrollHeight <= element.clientHeight + 1;
  })).toBe(true);
  await timeline.locator('.ai-workflow-tool-batch > summary').click();
  await expect(timeline.locator('.ai-workflow-tool-item')).toHaveCount(3);
  await timeline.locator('.ai-workflow-tool-item').last().locator('summary').click();
  await expect(timeline.locator('.ai-workflow-tool-item').last().locator('pre')).toHaveCount(2);
  await expect.poll(() => timeline.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('assistant-workflow-mobile-364x725.png'), animations: 'disabled' });
});
