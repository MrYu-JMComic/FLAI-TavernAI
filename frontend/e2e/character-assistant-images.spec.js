import { expect, test } from '@playwright/test';
import { apiRequest, registerUser } from './helpers.js';

async function referenceImage(page, name = '角色参考.png') {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    context.fillStyle = '#365b6d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f0c8aa';
    context.fillRect(36, 28, 48, 56);
    context.fillStyle = '#bb657e';
    context.fillRect(24, 92, 72, 68);
    return canvas.toDataURL('image/png');
  });
  return { name, mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64'), dataUrl };
}

async function openAssistant(page) {
  await registerUser(page);
  await page.goto('/#/characters/new/assistant');
  await expect(page.getByRole('textbox', { name: '给角色助手发送消息' })).toBeEnabled();
  await expect(page.getByLabel('选择助手图片', { exact: true })).toBeEnabled();
}

test('assistant images can be removed, retried, sent without text and restored from saved sessions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAssistant(page);
  const image = await referenceImage(page);
  const input = page.getByLabel('选择助手图片', { exact: true });
  const previews = page.getByLabel('待发送图片', { exact: true });
  const send = page.getByRole('button', { name: '发送消息', exact: true });
  await expect(send).toBeDisabled();
  const chooseFile = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '添加图片', exact: true }).click();
  await (await chooseFile).setFiles({ name: image.name, mimeType: image.mimeType, buffer: image.buffer });
  await expect(previews.getByRole('img', { name: image.name, exact: true })).toBeVisible();
  await previews.getByRole('button', { name: `移除图片 ${image.name}`, exact: true }).click();
  await expect(previews).toHaveCount(0);
  await expect(send).toBeDisabled();
  await input.setInputFiles({ name: image.name, mimeType: image.mimeType, buffer: image.buffer });
  await expect(send).toBeEnabled();

  const requests = [];
  const uploads = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/assets') && request.method() === 'POST') uploads.push(request);
  });
  let rejectNext = true;
  await page.route('**/api/characters/complete-draft', async route => {
    requests.push(route.request().postDataJSON());
    if (rejectNext) {
      rejectNext = false;
      return route.fulfill({ status: 503, json: { error: '图片请求暂时失败，请重试' } });
    }
    return route.continue();
  });
  await send.click();
  await expect(page.locator('.assistant-run-error')).toContainText('图片请求暂时失败');
  await expect(previews.getByRole('img', { name: image.name, exact: true })).toBeVisible();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.locator('.assistant-message.from-assistant')).toContainText('当前使用本地 Mock');
  await expect(previews).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(uploads).toHaveLength(1);
  expect(requests[1].attachments[0].url).toBe(requests[0].attachments[0].url);
  expect(requests[1].attachments).toHaveLength(1);
  expect(requests[1].attachments[0].url).toMatch(/^\/api\/assets\//);
  expect(requests[1].attachments[0].dataUrl).toBeUndefined();

  const sentImage = page.locator('.assistant-message.from-user .assistant-message-attachments').getByRole('img', { name: image.name, exact: true });
  await expect(sentImage).toHaveAttribute('src', /^\/api\/assets\//);
  await expect.poll(() => sentImage.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  const assetUrl = await sentImage.getAttribute('src');
  const sessions = await apiRequest(page, '/api/character-assistant/sessions?unbound=true');
  const savedMessage = sessions[0].messages.find(message => message.role === 'user');
  expect(savedMessage.attachments[0].url).toBe(assetUrl);
  expect(savedMessage.attachments[0].dataUrl).toBeUndefined();
  expect(JSON.stringify(sessions[0].state)).not.toContain('data:image/');
  await page.screenshot({ path: testInfo.outputPath('assistant-images-desktop.png') });

  await page.reload();
  await expect(sentImage).toHaveAttribute('src', assetUrl);
  await expect.poll(() => sentImage.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  const followUpText = '继续参考这张图讨论角色。';
  const followUpRequest = page.waitForRequest(request => (
    request.url().endsWith('/api/characters/complete-draft')
    && request.method() === 'POST'
    && request.postDataJSON()?.requirement === followUpText
  ));
  await page.getByRole('textbox', { name: '给角色助手发送消息' }).fill(followUpText);
  await send.click();
  const followUpPayload = (await followUpRequest).postDataJSON();
  expect(followUpPayload.attachments || []).toHaveLength(0);
  await expect(page.locator('.assistant-message.from-assistant:not(.is-live)')).toHaveCount(2);
  await expect(page.getByRole('log', { name: '与角色完善助手的对话' })).toHaveAttribute('aria-busy', 'false');
  await expect(send).toBeDisabled();
  await expect(sentImage).toHaveCount(1);

  await input.setInputFiles({ name: image.name, mimeType: image.mimeType, buffer: image.buffer });
  await expect(previews).toBeVisible();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.locator('.assistant-welcome')).toBeVisible();
  await expect(previews).toHaveCount(0);
  await expect(page.locator('.assistant-message-attachments')).toHaveCount(0);
  await expect(send).toBeDisabled();
});

test('four large reference images upload separately within the existing request body limit', async ({ page }) => {
  await openAssistant(page);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1000;
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(1000, 1000);
    for (let offset = 0; offset < pixels.data.length; offset += 65536) {
      crypto.getRandomValues(pixels.data.subarray(offset, Math.min(offset + 65536, pixels.data.length)));
    }
    for (let offset = 3; offset < pixels.data.length; offset += 4) pixels.data[offset] = 255;
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  expect(buffer.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
  expect(dataUrl.length * 4).toBeGreaterThan(12 * 1024 * 1024);
  await page.getByLabel('选择助手图片', { exact: true }).setInputFiles(
    Array.from({ length: 4 }, (_, index) => ({ name: `大参考图${index + 1}.png`, mimeType: 'image/png', buffer }))
  );
  await expect(page.getByLabel('待发送图片', { exact: true }).locator('img')).toHaveCount(4);
  const request = page.waitForRequest(request => request.url().endsWith('/api/characters/complete-draft') && request.method() === 'POST');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const completionRequest = await request;
  const payload = completionRequest.postDataJSON();
  expect(payload.attachments).toHaveLength(4);
  expect(payload.attachments.every(attachment => attachment.url?.startsWith('/api/assets/') && !attachment.dataUrl)).toBe(true);
  expect(completionRequest.postDataBuffer().byteLength).toBeLessThan(100_000);
  await expect(page.locator('.assistant-message.from-assistant')).toContainText('当前使用本地 Mock');
  await expect(page.locator('.assistant-message.from-user .assistant-message-attachments img')).toHaveCount(4);
});

test.describe('assistant image input on phones', () => {
  test.use({ isMobile: true, hasTouch: true });

  test('pasted and dropped images accompany multiline text without overflowing the phone', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAssistant(page);
    const image = await referenceImage(page, '粘贴参考.png');
    const composer = page.getByRole('textbox', { name: '给角色助手发送消息' });
    const previews = page.getByLabel('待发送图片', { exact: true });
    await composer.evaluate((element, { dataUrl, name }) => {
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), char => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, { dataUrl: image.dataUrl, name: image.name });
    await expect(previews.locator('img')).toHaveCount(1);
    await page.locator('.assistant-composer').evaluate((element, dataUrl) => {
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), char => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], '拖入参考.png', { type: 'image/png' }));
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }, image.dataUrl);
    await expect(previews.locator('img')).toHaveCount(2);
    await composer.fill('参考人物形象');
    await composer.press('Enter');
    await composer.pressSequentially('保留我的故事背景');
    await expect(composer).toHaveValue('参考人物形象\n保留我的故事背景');
    await expect(page.locator('.assistant-message.from-user')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('assistant-images-mobile.png') });
    const request = page.waitForRequest(request => request.url().endsWith('/api/characters/complete-draft') && request.method() === 'POST');
    await page.getByRole('button', { name: '发送消息', exact: true }).tap();
    const payload = (await request).postDataJSON();
    expect(payload.requirement).toBe('参考人物形象\n保留我的故事背景');
    expect(payload.attachments).toHaveLength(2);
    await expect(page.locator('.assistant-message.from-assistant')).toContainText('当前使用本地 Mock');
    await expect(page.locator('.assistant-message.from-user .assistant-message-attachments img')).toHaveCount(2);
    await expect(previews).toHaveCount(0);
    await expect(composer).toHaveValue('');
  });
});
