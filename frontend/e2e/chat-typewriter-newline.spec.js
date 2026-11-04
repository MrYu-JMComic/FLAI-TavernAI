import { expect, test } from '@playwright/test';
import { apiRequest, registerUser, uniqueSuffix } from './helpers.js';

function sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

test('mobile chat streams through Markdown newlines and keeps the caret at the rendered text end', async ({ page }, testInfo) => {
  const suffix = uniqueSuffix();
  await page.setViewportSize({ width: 390, height: 844 });
  await registerUser(page, suffix);
  const character = await apiRequest(page, '/api/characters', {
    method: 'POST', body: { name: `Stream ${suffix}` }
  });
  const conversation = await apiRequest(page, '/api/conversations', {
    method: 'POST', body: { characterId: character.id }
  });
  const payload = await apiRequest(page, `/api/conversations/${conversation.id}/messages`);
  const userMessage = {
    id: `stream-user-${suffix}`,
    role: 'user',
    content: '继续',
    reasoning: '',
    createdAt: new Date().toISOString()
  };
  const assistantMessageId = `stream-assistant-${suffix}`;
  const firstStatusLine = '[21:26-九天玄女境>南域上空-炼气大圆满]';
  const secondStatusLine = '[凌月璃♀人族-玉臀宗长老-元婴]';
  const progressMarker = '流式分块跨过换行后仍继续输出';
  const longTail = Array.from({ length: 200 }, (_, index) => (
    `第${index + 1}段继续记录角色的动作和场景变化，长回复在手机上保持连续渲染。`
  )).join('\n');
  const paragraph = `回复起始内容，${progressMarker}。${longTail}`;
  const fullText = `${firstStatusLine}\n${secondStatusLine}\n\n${paragraph}`;
  const contentChunks = [
    `${firstStatusLine}\n`,
    `${secondStatusLine}\n\n`,
    paragraph.slice(0, 88),
    ...paragraph.slice(88).match(/.{1,88}/gs)
  ];
  const assistantMessage = {
    id: assistantMessageId,
    role: 'assistant',
    content: fullText,
    reasoning: '',
    createdAt: new Date().toISOString()
  };
  let generationSubmitted = false;

  await page.evaluate(() => localStorage.setItem('flai-chat-use-stream', 'true'));
  await page.evaluate(({ conversationId: targetConversationId, events }) => {
    const nativeFetch = window.fetch.bind(window);
    window.__chatStreamFetchRequests = [];
    window.fetch = (input, init = {}) => {
      const requestUrl = new URL(typeof input === 'string' ? input : input.url, window.location.href);
      const requestMethod = String(init.method || input.method || 'GET').toUpperCase();
      const targetPath = `/api/conversations/${targetConversationId}/messages`;
      window.__chatStreamFetchRequests.push({ method: requestMethod, pathname: requestUrl.pathname });
      if (requestMethod !== 'POST' || requestUrl.pathname !== targetPath) {
        return nativeFetch(input, init);
      }

      let timer = null;
      let cancelled = false;
      const body = new ReadableStream({
        start(controller) {
          let eventIndex = 0;
          const enqueueNextEvent = () => {
            if (cancelled) return;
            if (init.signal?.aborted) {
              cancelled = true;
              controller.close();
              return;
            }
            if (eventIndex >= events.length) {
              controller.close();
              return;
            }
            controller.enqueue(new TextEncoder().encode(events[eventIndex++]));
            timer = window.setTimeout(enqueueNextEvent, 12);
          };
          timer = window.setTimeout(enqueueNextEvent, 24);
          init.signal?.addEventListener('abort', () => {
            cancelled = true;
            window.clearTimeout(timer);
          }, { once: true });
        },
        cancel() {
          cancelled = true;
          window.clearTimeout(timer);
        }
      });
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }
      }));
    };
  }, {
    conversationId: conversation.id,
    events: [
      ...contentChunks.map((text) => sseEvent('content', { text })),
      sseEvent('done', { userMessage, assistantMessage })
    ]
  });
  await page.route(`**/api/conversations/${conversation.id}/messages`, async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          ...payload,
          messages: generationSubmitted ? [userMessage, assistantMessage] : []
        }
      });
    }
    return route.continue();
  });
  await page.route(`**/api/messages/${assistantMessageId}/swipes`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/conversations/${conversation.id}/branches`, (route) => route.fulfill({ json: [] }));
  await page.goto(`/#/chat/${conversation.id}`);

  const composer = page.getByLabel('聊天消息输入');
  await composer.fill('继续');
  generationSubmitted = true;
  await page.getByRole('button', { name: '发送消息' }).click();

  const stopButton = page.getByRole('button', { name: '停止生成' });
  await expect(stopButton).toBeVisible();
  const fetchRequests = await page.evaluate(() => window.__chatStreamFetchRequests);
  expect(fetchRequests).toContainEqual({
    method: 'POST',
    pathname: `/api/conversations/${conversation.id}/messages`
  });
  const streamingBubble = page.locator('.deep-bubble.is-typing').last();
  const markdown = streamingBubble.locator('.markdown-content');
  await expect(markdown).toContainText(progressMarker, { timeout: 10_000 });
  await expect(stopButton).toBeVisible();
  await expect(markdown.locator('.typing-caret')).toHaveCount(1);
  const streamedPrefix = await markdown.innerText();
  expect(streamedPrefix).toContain(progressMarker);
  expect(streamedPrefix.replace(/\s+/g, '').length).toBeLessThan(fullText.replace(/\s+/g, '').length);

  const caretGeometry = await markdown.evaluate((root) => {
    const caret = root.querySelector('.typing-caret');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let lastText = null;
    let node = walker.nextNode();
    while (node) {
      if (node.nodeValue?.trim() && !node.parentElement?.closest('.katex')) lastText = node;
      node = walker.nextNode();
    }
    if (!caret || !lastText?.nodeValue) return null;
    const range = document.createRange();
    range.setStart(lastText, lastText.nodeValue.length - 1);
    range.setEnd(lastText, lastText.nodeValue.length);
    const textRect = range.getBoundingClientRect();
    const caretRect = caret.getBoundingClientRect();
    return {
      sameLine: Math.min(textRect.bottom, caretRect.bottom) > Math.max(textRect.top, caretRect.top),
      horizontalGap: caretRect.left - textRect.right
    };
  });
  expect(caretGeometry).not.toBeNull();
  expect(caretGeometry.sameLine).toBe(true);
  expect(Math.abs(caretGeometry.horizontalGap - 3)).toBeLessThan(5);
  await page.screenshot({ path: testInfo.outputPath('chat-stream-after-newline-mobile-390.png'), animations: 'disabled' });

  await expect(stopButton).toBeHidden({ timeout: 15_000 });
  const completedMessage = page.locator(`.deep-message[data-message-id="${assistantMessageId}"]`);
  const completedMarkdown = completedMessage.locator('.markdown-content');
  await expect(completedMarkdown.locator('> p')).toHaveCount(2);
  await expect(completedMarkdown.locator('> p').first().locator('br')).toHaveCount(1);
  const rendered = await completedMarkdown.evaluate((element) => element.innerText.replace(/\s+/g, ''));
  expect(rendered).toBe(fullText.replace(/\s+/g, ''));
  await expect(completedMarkdown.locator('.typing-caret')).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1441);
  await page.screenshot({ path: testInfo.outputPath('chat-stream-after-newline-desktop-1440.png'), animations: 'disabled' });
});
