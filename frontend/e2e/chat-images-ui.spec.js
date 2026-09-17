import { expect, test } from '@playwright/test';

const imageSizes = [
  { name: 'Square image', width: 768, height: 768 },
  { name: 'Portrait image', width: 1024, height: 1536 },
  { name: 'Landscape image', width: 1536, height: 1024 },
  { name: 'Panorama image', width: 2400, height: 400 }
];

async function openImageConversation(page) {
  const images = await page.evaluate((sizes) => sizes.map((size) => {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#267f88';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#eed16b';
    context.fillRect(0, 0, canvas.width / 3, canvas.height / 3);
    context.fillStyle = '#ba4f65';
    context.fillRect(canvas.width * 2 / 3, canvas.height * 2 / 3, canvas.width / 3, canvas.height / 3);
    return { ...size, src: canvas.toDataURL('image/png') };
  }), imageSizes);
  const character = { id: 'image-character', name: 'Image preview', avatarUrl: '/icons/icon-192.png' };
  const conversation = { id: 'image-preview', title: 'Image preview', characterId: character.id, character, settings: {} };
  const messages = images.map((image, index) => ({
    id: `image-message-${index}`,
    role: 'assistant',
    content: `Generated image:\n\n![${image.name}](${image.src})\n\nImage details remain below the frame.`
  }));

  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (!pathname.startsWith('/api/')) return route.continue();
    if (pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'image-reader', username: 'Image reader' } } });
    if (pathname === '/api/settings/provider') return route.fulfill({ json: { model: 'preview-model', gatewayName: 'Local' } });
    if (pathname === '/api/conversations/image-preview/messages') return route.fulfill({ json: { conversation, messages } });
    if (pathname === '/api/conversations') return route.fulfill({ json: [conversation] });
    if (pathname === '/api/characters') return route.fulfill({ json: [character] });
    if (pathname === '/api/presets' || pathname.endsWith('/branches')) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.goto('/#/chat/image-preview');
  await expect(page.locator('.deep-bubble .markdown-content img')).toHaveCount(images.length);
  await expect.poll(() => page.locator('.deep-bubble .markdown-content img').evaluateAll((elements) => elements.every((element) => element.complete && element.naturalWidth > 0))).toBe(true);
}

for (const theme of ['light', 'dark']) {
  test(`chat image frames fit the message and viewport without cropping in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('flai-theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openImageConversation(page);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 753, height: 958 },
      { width: 440, height: 627 },
      { width: 375, height: 812 },
      { width: 320, height: 740 },
      { width: 844, height: 390 }
    ]) {
      await page.setViewportSize(viewport);
      if (viewport.width < 981) {
        const closeSidebar = page.getByRole('button', { name: '\u6536\u8d77\u4fa7\u8fb9\u680f', exact: true });
        if (await closeSidebar.isVisible()) await closeSidebar.click();
        await expect(page.locator('.deep-sidebar')).toHaveClass(/collapsed/);
      }
      for (const size of imageSizes) {
        const image = page.getByRole('img', { name: size.name, exact: true });
        await image.scrollIntoViewIfNeeded();
        await expect(image).toBeInViewport({ ratio: 1 });
        const metrics = await image.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const parent = element.parentElement.getBoundingClientRect();
          const style = getComputedStyle(element);
          const insetX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
          const insetY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
          return {
            width: box.width,
            height: box.height,
            contentRatio: (box.width - insetX) / (box.height - insetY),
            contained: box.left >= parent.left - 1 && box.right <= parent.right + 1,
            unobstructed: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === element,
            centerOffset: Math.abs(box.left + box.width / 2 - parent.left - parent.width / 2),
            border: style.borderTopStyle,
            objectFit: style.objectFit
          };
        });
        expect(metrics.width).toBeLessThanOrEqual(640);
        expect(metrics.height).toBeLessThanOrEqual(Math.min(560, viewport.height * 0.56, viewport.height - 240) + 1);
        expect(metrics.contentRatio).toBeCloseTo(size.width / size.height, 2);
        expect(metrics.contained).toBe(true);
        expect(metrics.unobstructed).toBe(true);
        expect(metrics.centerOffset).toBeLessThan(1);
        expect(metrics.border).toBe('solid');
        expect(metrics.objectFit).toBe('contain');
        if (size.name === 'Square image') {
          await page.screenshot({ path: testInfo.outputPath(`image-frame-${theme}-${viewport.width}.png`) });
        }
      }
      await expect.poll(() => page.locator('.deep-bubble .markdown-content').evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
      await expect(page.getByRole('textbox', { name: '聊天消息输入' })).toBeVisible();
    }
    await expect(page.locator('.deep-message-avatar img').first()).toHaveCSS('padding-top', '0px');
  });
}
