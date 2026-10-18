import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('mobile chat composer stays inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerUser(page, uniqueSuffix());

  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await page.getByRole('button', { name: /完整表单/ }).click();
  await page.getByLabel('角色名').fill(`移动端角色 ${uniqueSuffix()}`);
  await page.getByRole('button', { name: /保存角色/ }).click();
  await expect(page).toHaveURL(/#\/characters\/[^/]+\/edit/, { timeout: 15_000 });

  await page.getByRole('button', { name: /^返回$/ }).click();
  const characterCard = page.locator('.home-character-card').first();
  await expect(characterCard).toBeVisible();
  await characterCard.getByRole('button', { name: /对话/ }).click();
  await expect(page).toHaveURL(/#\/chat\/[^/]+/, { timeout: 15_000 });

  const composer = page.locator('.deep-composer-wrap');
  await expect(composer).toBeVisible();
  const viewport = page.viewportSize();
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(120);
  const desktopBox = await composer.boundingBox();
  const messageScroller = page.locator('.deep-message-scroll');
  const messageScrollerBox = await messageScroller.boundingBox();
  const assistantContent = page.locator('.deep-message.assistant .deep-message-content');
  const assistantContentCount = await assistantContent.count();
  const assistantContentBox = assistantContentCount === 1
    ? await assistantContent.boundingBox()
    : null;
  expect(desktopBox).not.toBeNull();
  expect(messageScrollerBox).not.toBeNull();
  expect(desktopBox.x).toBeGreaterThanOrEqual(0);
  expect(desktopBox.x + desktopBox.width).toBeLessThanOrEqual(1441);
  if (assistantContentBox) {
    expect(desktopBox.width).toBeGreaterThan(assistantContentBox.width + 40);
  }
  expect(messageScrollerBox.y + messageScrollerBox.height).toBeLessThanOrEqual(desktopBox.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1441);

  const scrollProbe = await messageScroller.evaluate((element) => {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.flex = `0 0 ${Math.max(1200, element.clientHeight * 2)}px`;
    element.appendChild(probe);
    element.scrollTop = element.scrollHeight;
    const result = {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop
    };
    probe.remove();
    return result;
  });
  expect(scrollProbe.clientHeight).toBeGreaterThan(0);
  expect(scrollProbe.scrollHeight).toBeGreaterThan(scrollProbe.clientHeight);
  expect(scrollProbe.scrollTop).toBeGreaterThan(0);

  await page.getByRole('button', { name: '打开侧边栏' }).click();
  await expect(page.locator('.deep-chat-shell')).not.toHaveClass(/sidebar-collapsed/);

  const expandedComposerBox = await composer.boundingBox();
  const expandedMessageScrollerBox = await messageScroller.boundingBox();
  const expandedSidebarBox = await page.locator('.deep-sidebar').boundingBox();
  expect(expandedComposerBox).not.toBeNull();
  expect(expandedMessageScrollerBox).not.toBeNull();
  expect(expandedSidebarBox).not.toBeNull();
  expect(expandedComposerBox.y + expandedComposerBox.height).toBeLessThanOrEqual(901);
  if (assistantContentBox) {
    expect(expandedComposerBox.width).toBeGreaterThan(assistantContentBox.width + 40);
  }
  expect(expandedMessageScrollerBox.y + expandedMessageScrollerBox.height).toBeLessThanOrEqual(expandedComposerBox.y + 1);
  expect(expandedSidebarBox.y + expandedSidebarBox.height).toBeLessThanOrEqual(901);
});

test('focused multiline composer settles when shrinking the whole chat viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await registerUser(page);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Resize ${uniqueSuffix()}`, firstMessage: 'A quiet conversation.' }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST', body: { characterId: character.id }
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/#/chat/${conversation.id}`);
  const textarea = page.getByRole('textbox', { name: '聊天消息输入' });
  const draft = Array.from({ length: 8 }, (_, index) => (
    `${index + 1}. ${'A long draft keeps wrapping while the viewport shrinks. '.repeat(3)}`
  )).join('\n');
  await textarea.fill(draft);
  await textarea.focus();

  for (const viewport of [
    { width: 760, height: 600 },
    { width: 620, height: 500 },
    { width: 390, height: 420 },
    { width: 320, height: 300 },
    { width: 844, height: 390 }
  ]) {
    await page.setViewportSize(viewport);
    const frames = await page.evaluate(async () => {
      const frames = [];
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      };
      for (let index = 0; index < 36; index++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const textarea = document.querySelector('.deep-composer textarea');
        const scroller = document.querySelector('.deep-message-scroll');
        frames.push({
          shell: rect('.deep-chat-shell'), composer: rect('.deep-composer-wrap'),
          textarea: rect('.deep-composer textarea'), scroller: rect('.deep-message-scroll'),
          textareaScrollTop: textarea.scrollTop, messageScrollTop: scroller.scrollTop,
          pageScrollTop: window.scrollY, focused: document.activeElement === textarea
        });
      }
      return frames.slice(-12);
    });
    const stable = frames.at(-1);
    expect(new Set(frames.map((frame) => JSON.stringify(frame))).size, `stable frames at ${viewport.width}`).toBe(1);
    expect(stable.focused).toBe(true);
    expect(stable.pageScrollTop).toBe(0);
    expect(stable.composer[0]).toBeGreaterThanOrEqual(0);
    expect(stable.composer[0] + stable.composer[2]).toBeLessThanOrEqual(viewport.width + 1);
    expect(stable.composer[1] + stable.composer[3]).toBeLessThanOrEqual(viewport.height + 1);
    expect(stable.textarea[1]).toBeGreaterThanOrEqual(0);
    expect(stable.scroller[3]).toBeGreaterThan(0);
    await expect(textarea).toHaveValue(draft);
  }

  // Keyboard panning emits visualViewport scroll/resize repeatedly. With the
  // content and width unchanged, those events should preserve the draft's
  // internal scrolling and avoid collapsing the focused textarea to measure it.
  await page.setViewportSize({ width: 390, height: 500 });
  await page.evaluate(async () => {
    for (let index = 0; index < 8; index++) await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  const viewportEvents = await textarea.evaluate(async (element) => {
    element.scrollTop = 120;
    element.setSelectionRange(12, 12);
    const scrollTop = element.scrollTop;
    const height = element.offsetHeight;
    const mutations = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    for (let index = 0; index < 8; index++) {
      window.visualViewport.dispatchEvent(new Event('scroll'));
      window.visualViewport.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    observer.disconnect();
    return {
      mutations: mutations.length, scrollTop, currentScrollTop: element.scrollTop,
      height, currentHeight: element.offsetHeight, selectionStart: element.selectionStart
    };
  });
  expect(viewportEvents.mutations).toBe(0);
  expect(viewportEvents.currentScrollTop).toBe(viewportEvents.scrollTop);
  expect(viewportEvents.currentHeight).toBe(viewportEvents.height);
  expect(viewportEvents.selectionStart).toBe(12);
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue(draft);
  expect(errors).toEqual([]);
});
