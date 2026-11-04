import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

test('mobile chat composer stays inside the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerUser(page, uniqueSuffix());

  await page.getByRole('button', { name: /创建角色/ }).first().click();
  await page.getByRole('button', { name: /完整表单/ }).click();
  await page.getByLabel('角色名').fill(`移动端角色 ${uniqueSuffix()}`);
  const openingMessage = '欢迎开始这段移动端对话。';
  await page.getByLabel('角色开场白内容').fill(openingMessage);
  await page.getByRole('button', { name: /保存角色/ }).click();
  await expect(page).toHaveURL(/#\/characters\/[^/]+\/edit/, { timeout: 15_000 });

  await page.getByRole('button', { name: /^返回$/ }).click();
  const characterCard = page.locator('.home-character-card').first();
  await expect(characterCard).toBeVisible();
  await characterCard.getByRole('button', { name: /对话/ }).click();
  await expect(page).toHaveURL(/#\/chat\/[^/]+/, { timeout: 15_000 });

  const assistantContent = page.locator('.deep-message.assistant[data-message-id] .deep-message-content');
  await expect(assistantContent).toContainText(openingMessage);
  const mobileLineHeightRatio = await page.locator('.deep-message.assistant .deep-bubble').first().evaluate((bubble) => (
    Number.parseFloat(getComputedStyle(bubble).lineHeight) / Number.parseFloat(getComputedStyle(bubble).fontSize)
  ));
  expect(mobileLineHeightRatio).toBeCloseTo(1.45, 2);
  await page.screenshot({ path: testInfo.outputPath('chat-typography-mobile-390.png'), animations: 'disabled' });
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
  const desktopLineHeightRatio = await page.locator('.deep-message.assistant .deep-bubble').first().evaluate((bubble) => (
    Number.parseFloat(getComputedStyle(bubble).lineHeight) / Number.parseFloat(getComputedStyle(bubble).fontSize)
  ));
  expect(desktopLineHeightRatio).toBeCloseTo(1.45, 2);
  await page.screenshot({ path: testInfo.outputPath('chat-typography-desktop-1440.png'), animations: 'disabled' });
  const desktopBox = await composer.boundingBox();
  const messageScroller = page.locator('.deep-message-scroll');
  const messageScrollerBox = await messageScroller.boundingBox();
  const assistantContentBox = await assistantContent.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(messageScrollerBox).not.toBeNull();
  expect(assistantContentBox).not.toBeNull();
  expect(desktopBox.x).toBeGreaterThanOrEqual(0);
  expect(desktopBox.x + desktopBox.width).toBeLessThanOrEqual(1441);
  expect(desktopBox.width).toBeGreaterThan(assistantContentBox.width + 40);
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
  const expandedAssistantContentBox = await assistantContent.boundingBox();
  expect(expandedComposerBox).not.toBeNull();
  expect(expandedMessageScrollerBox).not.toBeNull();
  expect(expandedSidebarBox).not.toBeNull();
  expect(expandedAssistantContentBox).not.toBeNull();
  expect(expandedComposerBox.y + expandedComposerBox.height).toBeLessThanOrEqual(901);
  expect(expandedComposerBox.width).toBeGreaterThan(expandedAssistantContentBox.width + 40);
  expect(expandedMessageScrollerBox.y + expandedMessageScrollerBox.height).toBeLessThanOrEqual(expandedComposerBox.y + 1);
  expect(expandedSidebarBox.y + expandedSidebarBox.height).toBeLessThanOrEqual(901);
});

test('focused multiline composer settles when shrinking the whole chat viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await registerUser(page);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Resize ${uniqueSuffix()}`, openingMessage: 'A quiet conversation.' }
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

test('overlay history sidebar keeps a long chat stable at 991px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 991, height: 930 });
  await registerUser(page, uniqueSuffix());
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Sidebar ${uniqueSuffix()}` }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST', body: { characterId: character.id }
  });
  const payload = await apiRequest(page, `/api/conversations/${conversation.id}/messages`);
  const messages = Array.from({ length: 160 }, (_, index) => ({
    id: `sidebar-history-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    reasoning: '',
    content: `Message ${index}\n\n${'A long message keeps enough content mounted to exercise the virtualized chat layout. '.repeat(8)}`,
    createdAt: new Date(1700000000000 + index * 1000).toISOString()
  }));
  await page.route(`**/api/conversations/${conversation.id}/messages`, (route) => (
    route.fulfill({ json: { ...payload, messages } })
  ));
  await page.route('**/api/messages/sidebar-history-*/swipes', (route) => route.fulfill({ json: [] }));

  await page.goto(`/#/chat/${conversation.id}`);
  const shell = page.locator('.deep-chat-shell');
  const scroller = page.locator('.deep-message-scroll');
  await expect(page.locator('.deep-message[data-message-id="sidebar-history-159"]')).toBeVisible();
  await expect(shell).toHaveClass(/sidebar-collapsed/);
  await page.getByRole('button', { name: '切换到夜间模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const measureChat = () => page.evaluate(() => {
    const shellElement = document.querySelector('.deep-chat-shell');
    const scrollerElement = document.querySelector('.deep-message-scroll');
    const message = document.querySelector('.deep-message');
    const bubble = document.querySelector('.deep-message.assistant .deep-bubble');
    return {
      readableWidth: getComputedStyle(shellElement).getPropertyValue('--chat-readable-width').trim(),
      composerWidth: getComputedStyle(shellElement).getPropertyValue('--chat-composer-width').trim(),
      scrollerWidth: scrollerElement.getBoundingClientRect().width,
      messageWidth: message?.getBoundingClientRect().width ?? 0,
      scrollTop: scrollerElement.scrollTop,
      bubbleBackdropFilter: bubble ? getComputedStyle(bubble).backdropFilter : '',
      bubbleLineHeightRatio: bubble
        ? Number.parseFloat(getComputedStyle(bubble).lineHeight) / Number.parseFloat(getComputedStyle(bubble).fontSize)
        : 0,
      paragraphMarginRatio: bubble?.querySelector('.markdown-content p')
        ? Number.parseFloat(getComputedStyle(bubble.querySelector('.markdown-content p')).marginBottom) / Number.parseFloat(getComputedStyle(bubble).fontSize)
        : 0
    };
  });

  const before = await measureChat();
  await page.getByRole('button', { name: '打开侧边栏' }).click();
  await expect(shell).not.toHaveClass(/sidebar-collapsed/);
  await expect(page.locator('.sidebar-backdrop')).toHaveCSS('opacity', '1');
  const after = await measureChat();

  expect(after.readableWidth).toBe(before.readableWidth);
  expect(after.composerWidth).toBe(before.composerWidth);
  expect(after.scrollerWidth).toBe(before.scrollerWidth);
  expect(after.messageWidth).toBe(before.messageWidth);
  expect(after.scrollTop).toBe(before.scrollTop);
  expect(after.bubbleBackdropFilter).toBe('none');
  expect(after.bubbleLineHeightRatio).toBeCloseTo(1.45, 2);
  expect(after.paragraphMarginRatio).toBeCloseTo(0.3, 2);
  await page.screenshot({ path: testInfo.outputPath('chat-sidebar-overlay-991.png'), animations: 'disabled' });

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(shell).toHaveClass(/sidebar-collapsed/);
  await expect.poll(async () => (await measureChat()).readableWidth).toBe(before.readableWidth);
});

test('mobile composer reopens the keyboard without duplicate viewport docking while focus is retained', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => window.localStorage.setItem('flai-theme', 'dark'));
  await registerUser(page, uniqueSuffix());
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: 'Keyboard ' + uniqueSuffix() }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST', body: { characterId: character.id }
  });

  await page.goto('/#/chat/' + conversation.id);
  const textarea = page.getByRole('textbox', { name: '聊天消息输入' });
  const shell = page.locator('.deep-chat-shell');
  const composer = page.locator('.deep-composer');
  await expect(textarea).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const composerTextStyle = async () => textarea.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderWidth: style.borderTopWidth,
      outline: style.outlineStyle,
      boxShadow: style.boxShadow,
      background: style.backgroundColor,
      resize: style.resize
    };
  });
  const unfocusedTextStyle = await composerTextStyle();
  expect(unfocusedTextStyle).toEqual({
    borderWidth: '0px',
    outline: 'none',
    boxShadow: 'none',
    background: 'rgba(0, 0, 0, 0)',
    resize: 'none'
  });
  await page.screenshot({ path: testInfo.outputPath('chat-composer-mobile-before-focus.png'), animations: 'disabled' });
  await textarea.focus();
  expect(await composerTextStyle()).toEqual(unfocusedTextStyle);

  await page.evaluate(() => {
    const viewport = window.visualViewport;
    let simulatedHeight = viewport.height;
    let simulatedOffsetTop = viewport.offsetTop;
    const simulatedViewport = new Proxy(viewport, {
      get(target, property) {
        if (property === 'height') return simulatedHeight;
        if (property === 'offsetTop') return simulatedOffsetTop;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: simulatedViewport });
    window.__readChatDockGeometry = () => ({
      viewportHeight: window.visualViewport.height,
      shellHeight: Number.parseFloat(getComputedStyle(document.querySelector('.deep-chat-shell')).height),
      composerBottom: document.querySelector('.deep-composer').getBoundingClientRect().bottom
    });
    window.__setChatVisualViewport = (height) => {
      simulatedHeight = height;
      simulatedOffsetTop = 0;
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    };
  });
  const setVisualViewportHeight = async (height) => page.evaluate((nextHeight) => {
    window.__setChatVisualViewport(nextHeight);
    return new Promise((resolve) => requestAnimationFrame(() => resolve(window.__readChatDockGeometry())));
  }, height);
  const expectDockedAt = async (height) => {
    const geometry = await setVisualViewportHeight(height);
    expect(geometry.viewportHeight).toBe(height);
    expect(geometry.shellHeight).toBe(height);
    expect(geometry.composerBottom).toBeLessThanOrEqual(height + 1);
    expect(geometry.composerBottom).toBeGreaterThanOrEqual(height - 1);
  };
  const keyboardHeight = 430;
  for (const height of [700, 560, keyboardHeight]) {
    await expectDockedAt(height);
  }
  await expect(shell).toHaveCSS('height', keyboardHeight + 'px');
  await expect(shell).toHaveCSS('--chat-keyboard-inset', '414px');
  let composerBox = await composer.boundingBox();
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(keyboardHeight + 1);

  for (const height of [560, 700, 844]) {
    await expectDockedAt(height);
  }
  await expect(textarea).toBeFocused();
  await expect(shell).toHaveCSS('--chat-keyboard-inset', '0px');
  await textarea.click();
  const frameRequests = await page.evaluate(() => {
    window.__chatDockFrameRequests = 0;
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      window.__chatDockFrameRequests += 1;
      return originalRequestAnimationFrame(callback);
    };
    window.__setChatVisualViewport(700);
    window.__setChatVisualViewport(560);
    window.__setChatVisualViewport(430);
    return window.__chatDockFrameRequests;
  });
  expect(frameRequests).toBe(1);
  const reopenedFrames = [];
  for (const height of [700, 560, keyboardHeight]) {
    reopenedFrames.push(await setVisualViewportHeight(height));
  }

  await expect(textarea).toBeFocused();
  await expect(shell).toHaveCSS('height', keyboardHeight + 'px');
  await expect(shell).toHaveCSS('--chat-keyboard-inset', '414px');
  for (const [index, frame] of reopenedFrames.entries()) {
    const expectedHeight = [700, 560, keyboardHeight][index];
    expect(frame.viewportHeight).toBe(expectedHeight);
    expect(frame.shellHeight).toBe(expectedHeight);
    expect(frame.composerBottom).toBeLessThanOrEqual(expectedHeight + 1);
    expect(frame.composerBottom).toBeGreaterThanOrEqual(expectedHeight - 1);
  }
  composerBox = await composer.boundingBox();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('chat-composer-mobile-keyboard-reopened.png'), animations: 'disabled' });
});
