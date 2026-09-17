import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

const openingMessage = [
  '\u5979\u5408\u4e0a\u4e66\uff0c\u8f7b\u58f0\u8bf4\uff1a',
  '\u201c\u7b2c\u4e00\u884c\uff1a**\u522b\u62c5\u5fc3**\uff01',
  '\u7b2c\u4e8c\u884c\uff1a*\u6211\u5728\u8fd9\u91cc*\u2026\u2026',
  '',
  '\u65b0\u6bb5\u843d\uff1a[\u770b\u8fd9\u91cc](https://example.test/path?q=1&b=2) < > & \u300c\u597d\u7684\u300d\u201d',
  '',
  '\u5979\u7b49\u5f85\u4f60\u7684\u56de\u7b54\u3002',
  '',
  '`\u201c\u4ee3\u7801\u4fdd\u6301\u539f\u6837\u201d` $x^2$'
].join('\n');

async function openSettings(page) {
  await page.getByLabel('\u66f4\u591a\u804a\u5929\u5de5\u5177', { exact: true }).click();
  await page.getByRole('menuitem', { name: '\u4f1a\u8bdd\u8bbe\u7f6e', exact: true }).click();
  return page.getByRole('checkbox', { name: '\u5f15\u53f7\u5bf9\u767d\u7740\u8272', exact: true });
}

for (const theme of ['light', 'dark']) {
  test(`quoted dialogue preserves formatting and persists its toggle in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('flai-theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await registerUser(page);
    const character = await apiRequest(page, '/api/characters', {
      method: 'POST', body: { name: `Dialogue ${uniqueSuffix()}`, openingMessage }
    });
    const conversation = await apiRequest(page, '/api/conversations', {
      method: 'POST', body: { characterId: character.id }
    });
    const messageUrl = `/api/conversations/${conversation.id}/messages`;
    const original = await apiRequest(page, messageUrl);
    await page.goto(`/#/chat/${conversation.id}`);
    const body = page.locator('.deep-bubble .markdown-content').first();
    const spans = body.locator('.chat-dialogue-quote');
    await expect(spans.first()).toBeVisible();
    await expect(body.locator('strong .chat-dialogue-quote')).toHaveText('\u522b\u62c5\u5fc3');
    await expect(body.locator('em .chat-dialogue-quote')).toHaveText('\u6211\u5728\u8fd9\u91cc');
    await expect(body.locator('code .chat-dialogue-quote')).toHaveCount(0);
    await expect(body.locator('.katex .chat-dialogue-quote')).toHaveCount(0);
    await expect(body.locator('a')).toHaveAttribute('href', 'https://example.test/path?q=1&b=2');
    const originalText = await body.textContent();

    const contrast = await spans.first().evaluate((element) => {
      const style = getComputedStyle(element);
      const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      const luminance = (color) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(style.color);
      const background = luminance(surface);
      return {
        ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        distinct: style.color !== getComputedStyle(element.closest('.markdown-content')).color
      };
    });
    expect(contrast.distinct).toBe(true);
    expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);

    for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const collapse = page.getByRole('button', { name: '\u6536\u8d77\u4fa7\u8fb9\u680f', exact: true });
      if (await collapse.isVisible()) await collapse.click();
      expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`dialogue-${theme}-${viewport.width}.png`), animations: 'disabled' });
    }

    await page.setViewportSize({ width: 375, height: 812 });
    const toggle = await openSettings(page);
    await expect(toggle).toBeChecked();
    await page.locator('label.chat-setting-toggle').filter({ has: toggle }).click();
    await expect(toggle).not.toBeChecked();
    await expect(spans).toHaveCount(0);
    expect(await body.textContent()).toBe(originalText);
    const save = page.getByRole('button', { name: '\u4fdd\u5b58\u5e76\u5e94\u7528', exact: true });
    await save.click();
    await expect(save).toBeEnabled();
    expect((await apiRequest(page, `/api/conversations/${conversation.id}/settings`)).highlightDialogue).toBe(false);
    await page.reload();
    await expect(body).toBeVisible();
    await expect(spans).toHaveCount(0);
    const restoredToggle = await openSettings(page);
    await expect(restoredToggle).not.toBeChecked();
    await restoredToggle.focus();
    await restoredToggle.press('Space');
    await expect(restoredToggle).toBeChecked();
    await expect(spans.first()).toBeAttached();
    await save.click();
    await expect(save).toBeEnabled();
    expect((await apiRequest(page, messageUrl)).messages).toEqual(original.messages);
  });
}
