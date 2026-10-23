import { expect, test } from '@playwright/test';
import { apiRequest, registerUser } from './helpers.js';

async function openAssistant(page) {
  await registerUser(page);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: 'Viewport recovery', persona: 'A stable mobile workspace.' }
  });
  const session = await apiRequest(page, '/api/character-assistant/sessions', {
    method: 'POST', body: { characterId: character.id, character, state: { version: 4, status: 'idle' } }
  });
  // Keep the long transcript deterministic without a provider request or saved-data changes.
  await page.route(`**/api/character-assistant/sessions/${session.id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ json: { ...session, messages: [{
      id: 'viewport-transcript', role: 'assistant', status: 'completed',
      content: Array.from({ length: 45 }, (_, index) => `Paragraph ${index + 1}. A long conversation remains independently scrollable.`).join('\n\n')
    }] } });
  });
  await page.goto(`/#/characters/${character.id}/assistant`);
  await expect(page.getByRole('textbox', { name: '给角色助手发送消息' })).toBeEnabled();
  await expect(page.locator('.assistant-message.from-assistant')).toHaveCount(1);
  await page.evaluate(async () => {
    for (let index = 0; index < 4; index++) await new Promise(resolve => requestAnimationFrame(resolve));
  });
  return character;
}

async function installVisualViewport(page) {
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    const geometry = { height: 844, offsetTop: 0, width: 390, offsetLeft: 0, scale: 1 };
    for (const key of Object.keys(geometry)) Object.defineProperty(viewport, key, { get: () => geometry[key] });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.setTestVisualViewport = (next, event = 'resize') => {
      Object.assign(geometry, next);
      viewport.dispatchEvent(new Event(event));
    };
  });
}

async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    const shell = document.querySelector('.page-shell');
    return {
      header: box('.character-assistant-header'), composer: box('.assistant-composer-area'),
      transcript: box('.assistant-transcript'), shellScroll: shell.scrollTop, documentScroll: scrollY
    };
  });
}

test.describe('mobile Chrome assistant viewport', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

  test('viewport panning preserves the focused multiline draft and transcript position', async ({ page }, testInfo) => {
    await installVisualViewport(page);
    await openAssistant(page);
    const input = page.getByRole('textbox', { name: '给角色助手发送消息' });
    const draft = Array.from({ length: 18 }, (_, index) => `${index + 1}. A multiline draft that wraps inside the phone composer.`).join('\n');
    await input.fill(draft);
    await input.focus();
    await page.evaluate(() => window.setTestVisualViewport({ height: 460, offsetTop: 70 }));
    await expect.poll(async () => Math.round((await geometry(page)).header.top)).toBe(70);
    await page.locator('.assistant-transcript').evaluate(element => { element.scrollTop = 240; });
    const events = await input.evaluate(async (element) => {
      element.scrollTop = 100;
      element.setSelectionRange(12, 12);
      const before = { inputScroll: element.scrollTop, transcriptScroll: document.querySelector('.assistant-transcript').scrollTop };
      const mutations = [];
      const observer = new MutationObserver(records => mutations.push(...records));
      observer.observe(element, { attributes: true, attributeFilter: ['style'] });
      for (let index = 0; index < 8; index++) {
        window.setTestVisualViewport({}, 'scroll');
        window.setTestVisualViewport({}, 'resize');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      observer.disconnect();
      return {
        before, inputScroll: element.scrollTop,
        transcriptScroll: document.querySelector('.assistant-transcript').scrollTop,
        selectionStart: element.selectionStart, mutations: mutations.length
      };
    });
    await testInfo.attach('focused-viewport-events', { body: JSON.stringify(events, null, 2), contentType: 'application/json' });
    expect(events.mutations).toBe(0);
    expect(events.inputScroll).toBe(events.before.inputScroll);
    expect(events.transcriptScroll).toBe(events.before.transcriptScroll);
    expect(events.selectionStart).toBe(12);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(draft);
    const keyboard = await geometry(page);
    expect(keyboard.header.top).toBeGreaterThanOrEqual(70);
    expect(keyboard.composer.bottom).toBeLessThanOrEqual(531);
    expect(keyboard.transcript.height).toBeGreaterThan(0);

    // Chrome may report the restored height before its keyboard pan settles.
    // That transient state must not create an outer focus-scrollable ancestor.
    await page.evaluate(() => window.setTestVisualViewport({ height: 844, offsetTop: 70 }));
    await expect.poll(async () => Math.round((await geometry(page)).composer.bottom)).toBe(914);
    const transientShellScroll = await page.locator('.page-shell').evaluate(element => {
      element.scrollTop = 70;
      return element.scrollTop;
    });
    expect(transientShellScroll).toBe(0);

    await page.evaluate(() => window.setTestVisualViewport({ height: 844, offsetTop: 0 }));
    await expect.poll(async () => Math.round((await geometry(page)).header.top)).toBe(0);
    const closed = await geometry(page);
    expect(closed.composer.bottom).toBeGreaterThanOrEqual(843);
    expect(closed.composer.bottom).toBeLessThanOrEqual(845);
    expect(closed.shellScroll).toBe(0);
    expect(closed.documentScroll).toBe(0);
    await page.screenshot({ path: '../.runtime-check/assistant-mobile-keyboard-recovered.png' });
  });

  test('restored outer scrolling cannot hide the assistant header or leave a bottom gap', async ({ page }, testInfo) => {
    await installVisualViewport(page);
    await openAssistant(page);
    await page.locator('.assistant-transcript').evaluate(element => { element.scrollTop = 240; });
    // Android Chrome can retain the large 100vh root while the browser toolbar
    // reduces the dynamic viewport. Desktop emulation has no toolbar, so model
    // that extra root range explicitly before restoring its old scroll offset.
    await page.evaluate(() => {
      document.documentElement.style.minHeight = `${innerHeight + 64}px`;
      window.scrollTo(0, 64);
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    const restored = await geometry(page);
    await testInfo.attach('restored-viewport-geometry', { body: JSON.stringify(restored, null, 2), contentType: 'application/json' });
    await expect.poll(async () => Math.round((await geometry(page)).header.top)).toBe(0);
    await expect.poll(async () => (await geometry(page)).documentScroll).toBe(0);
    const settled = await geometry(page);
    expect(settled.composer.bottom).toBeGreaterThanOrEqual(843);
    expect(settled.composer.bottom).toBeLessThanOrEqual(845);
    expect(settled.transcript.height).toBeGreaterThan(0);
    expect(await page.locator('.assistant-transcript').evaluate(element => element.scrollTop)).toBe(240);
    await page.screenshot({ path: testInfo.outputPath('assistant-mobile-restored.png') });
    await page.screenshot({ path: '../.runtime-check/assistant-mobile-restored.png' });

    const beforePinch = await geometry(page);
    await page.evaluate(() => {
      window.setTestVisualViewport({ height: 422, offsetTop: 90, scale: 2 }, 'scroll');
      window.scrollTo(0, 64);
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.evaluate(async () => {
      for (let index = 0; index < 4; index++) await new Promise(resolve => requestAnimationFrame(resolve));
    });
    const pinched = await geometry(page);
    expect(pinched.documentScroll).toBe(64);
    expect(pinched.header).toEqual(beforePinch.header);
    expect(pinched.composer).toEqual(beforePinch.composer);
    await page.evaluate(() => window.setTestVisualViewport({ height: 844, offsetTop: 0, scale: 1 }));
    await expect.poll(async () => (await geometry(page)).documentScroll).toBe(0);
    await page.evaluate(() => {
      window.scrollTo(0, 64);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => (await geometry(page)).documentScroll).toBe(0);
    expect((await geometry(page)).shellScroll).toBe(0);
    expect(await page.locator('.assistant-transcript').evaluate(element => element.scrollTop)).toBe(240);
  });
});

test('desktop assistant stays bounded and ordinary workspace pages remain scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAssistant(page);
  const before = await geometry(page);
  expect(before.header.top).toBeGreaterThanOrEqual(0);
  expect(before.composer.bottom).toBeLessThanOrEqual(900);
  expect(before.transcript.height).toBeGreaterThan(0);
  await page.goto('/#/settings');
  await expect(page.getByRole('navigation', { name: '个人设置分区' })).toBeVisible();
  const scrolled = await page.locator('.page-shell').evaluate(element => {
    element.scrollTop = 250;
    return { scrollTop: element.scrollTop, range: element.scrollHeight - element.clientHeight };
  });
  expect(scrolled.range).toBeGreaterThan(0);
  expect(scrolled.scrollTop).toBeGreaterThan(0);
});
