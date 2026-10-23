import { expect, test } from '@playwright/test';
import { apiRequest, registerUser } from './helpers.js';

test('a resumed assistant keeps the avatar and can save twice on the same route', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerUser(page);
  const avatarUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = '#7392b7';
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/png');
  });
  const character = await apiRequest(page, '/api/characters', { method: 'POST', body: {
    name: 'Avatar resume regression', avatarUrl, persona: 'Keep the original avatar.'
  } });
  expect(character.avatarUrl).toBeTruthy();
  const { avatarUrl: omittedAvatar, ...legacyDraft } = character;
  const checkpoint = { character: { name: character.name, persona: 'Recovered character story.' }, completedSections: ['persona'] };
  await apiRequest(page, '/api/character-assistant/sessions', { method: 'POST', body: {
    characterId: character.id, title: 'Older interrupted conversation', character: legacyDraft,
    state: { version: 4, requirement: '继续完善角色', status: 'paused', checkpoint }
  } });

  await page.goto(`/#/characters/${character.id}/assistant`);
  const workspace = page.locator('.character-assistant-page');
  await expect(workspace.getByRole('button', { name: '继续完成', exact: true })).toBeEnabled();
  const request = page.waitForRequest(request => request.url().endsWith('/api/characters/complete-draft') && request.method() === 'POST');
  await workspace.getByRole('button', { name: '继续完成', exact: true }).click();
  expect((await request).postDataJSON().character.avatarUrl).toBe(character.avatarUrl);
  await expect(workspace.getByRole('log')).toHaveAttribute('aria-busy', 'false');
  await expect(workspace.getByRole('button', { name: '保存角色', exact: true })).toBeEnabled();

  for (let index = 0; index < 2; index += 1) {
    const response = page.waitForResponse(response => response.url().endsWith(`/api/characters/${character.id}`)
      && response.request().method() === 'PATCH' && response.ok());
    await workspace.getByRole('button', { name: '保存角色', exact: true }).click();
    expect((await (await response).json()).avatarUrl).toBe(character.avatarUrl);
    await expect(page.getByText('角色已保存', { exact: true }).first()).toBeVisible();
    await expect(workspace.getByRole('button', { name: '保存角色', exact: true })).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`#/characters/${character.id}/assistant$`));
  }

  await page.reload();
  await expect(workspace.getByRole('button', { name: '预览角色卡', exact: true })).toBeEnabled();
  await workspace.getByRole('button', { name: '预览角色卡', exact: true }).click();
  const avatar = page.getByRole('dialog', { name: '角色卡预览' }).getByRole('img', { name: '角色头像', exact: true });
  await expect(avatar).toHaveAttribute('src', character.avatarUrl);
  await expect.poll(() => avatar.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  expect((await apiRequest(page, `/api/characters/${character.id}`)).avatarUrl).toBe(character.avatarUrl);
});

for (const legacyAvatar of ['empty', 'outdated']) {
  test(`an older assistant conversation with an ${legacyAvatar} avatar keeps the current saved avatar`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerUser(page);
    const previousAvatar = await makeAvatar(page, '#b77392');
    const initial = await apiRequest(page, '/api/characters', { method: 'POST', body: {
      name: `Legacy ${legacyAvatar} avatar`, avatarUrl: previousAvatar, persona: 'Original character.'
    } });
    const current = await apiRequest(page, `/api/characters/${initial.id}`, { method: 'PATCH', body: {
      ...initial, avatarUrl: await makeAvatar(page, '#7392b7')
    } });
    const sessionAvatar = legacyAvatar === 'empty' ? '' : initial.avatarUrl;
    expect(current.avatarUrl).toBeTruthy();
    expect(current.avatarUrl).not.toBe(sessionAvatar);
    await apiRequest(page, '/api/character-assistant/sessions', { method: 'POST', body: {
      characterId: current.id, title: `Older ${legacyAvatar} avatar conversation`,
      character: { ...initial, avatarUrl: sessionAvatar },
      state: {
        version: 4, requirement: '继续完善角色', status: 'paused',
        checkpoint: { character: { name: current.name, persona: 'Recovered story.', avatarUrl: sessionAvatar }, completedSections: ['persona'] }
      }
    } });

    await page.goto(`/#/characters/${current.id}/assistant`);
    const workspace = page.locator('.character-assistant-page');
    await expectAvatarPreview(page, current.avatarUrl);
    const request = page.waitForRequest(request => request.url().endsWith('/api/characters/complete-draft') && request.method() === 'POST');
    await workspace.getByRole('button', { name: '继续完成', exact: true }).click();
    expect((await request).postDataJSON().character.avatarUrl).toBe(current.avatarUrl);
    await expect(workspace.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    await expectAvatarPreview(page, current.avatarUrl);

    const response = page.waitForResponse(response => response.url().endsWith(`/api/characters/${current.id}`)
      && response.request().method() === 'PATCH' && response.ok());
    await workspace.getByRole('button', { name: '保存角色', exact: true }).click();
    expect((await (await response).json()).avatarUrl).toBe(current.avatarUrl);
    await expect(workspace.getByRole('button', { name: '保存角色', exact: true })).toBeEnabled();
    await page.reload();
    await expectAvatarPreview(page, current.avatarUrl);
    expect((await apiRequest(page, `/api/characters/${current.id}`)).avatarUrl).toBe(current.avatarUrl);
  });
}

for (const avatarEdit of ['upload', 'removal']) {
  test(`a pending manual avatar ${avatarEdit} survives an older conversation handoff and refresh`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerUser(page);
    const character = await apiRequest(page, '/api/characters', { method: 'POST', body: {
      name: `Manual avatar ${avatarEdit}`, avatarUrl: await makeAvatar(page, '#b77392'), persona: 'Original character.'
    } });
    await apiRequest(page, '/api/character-assistant/sessions', { method: 'POST', body: {
      characterId: character.id, title: 'Existing conversation before manual edit', character,
      state: { version: 4, requirement: '继续完善角色', status: 'idle' }
    } });
    await page.goto(`/#/characters/${character.id}/edit`);
    await expect(page.getByRole('button', { name: 'AI 完善助手', exact: true })).toBeEnabled();
    await expect(page.locator('#section-basic .large-avatar img')).toHaveAttribute('src', character.avatarUrl);
    await expect(page.getByRole('button', { name: '移除头像', exact: true })).toBeVisible();
    const expectedAvatar = avatarEdit === 'upload' ? await makeAvatar(page, '#73b792') : '';
    if (avatarEdit === 'upload') {
      await page.locator('#section-basic input[type="file"]').setInputFiles({
        name: 'replacement-avatar.png', mimeType: 'image/png', buffer: Buffer.from(expectedAvatar.split(',')[1], 'base64')
      });
      await expect(page.locator('#section-basic .large-avatar img')).toHaveAttribute('src', expectedAvatar);
    } else {
      await page.getByRole('button', { name: '移除头像', exact: true }).click();
      await expect(page.locator('#section-basic .large-avatar img')).toHaveCount(0);
    }
    await expect(page.locator('.character-save-state')).toContainText('有未保存更改');
    await page.getByRole('button', { name: 'AI 完善助手', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/characters/${character.id}/assistant$`));
    await expectAvatarPreview(page, expectedAvatar);
    await page.reload();
    await expectAvatarPreview(page, expectedAvatar);

    const workspace = page.locator('.character-assistant-page');
    await workspace.getByRole('textbox', { name: '给角色助手发送消息' }).fill('保留当前草稿并检查结构');
    await workspace.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(workspace.locator('.assistant-message.from-assistant')).toHaveCount(1);
    await expect(workspace.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    await expectAvatarPreview(page, expectedAvatar);
    const response = page.waitForResponse(response => response.url().endsWith(`/api/characters/${character.id}`)
      && response.request().method() === 'PATCH' && response.ok());
    await workspace.getByRole('button', { name: '保存角色', exact: true }).click();
    const saved = await (await response).json();
    if (avatarEdit === 'upload') {
      expect(saved.avatarUrl).toBeTruthy();
      expect(saved.avatarUrl).not.toBe(character.avatarUrl);
    } else {
      expect(saved.avatarUrl).toBe('');
    }
    await expect(workspace.getByRole('button', { name: '保存角色', exact: true })).toBeEnabled();
    await expectAvatarPreview(page, saved.avatarUrl);
    const secondResponse = page.waitForResponse(response => response.url().endsWith(`/api/characters/${character.id}`)
      && response.request().method() === 'PATCH' && response.ok());
    await workspace.getByRole('button', { name: '保存角色', exact: true }).click();
    expect((await (await secondResponse).json()).avatarUrl).toBe(saved.avatarUrl);
    await expect(workspace.getByRole('button', { name: '保存角色', exact: true })).toBeEnabled();
    await expectAvatarPreview(page, saved.avatarUrl);
    await page.reload();
    await expectAvatarPreview(page, saved.avatarUrl);
    expect((await apiRequest(page, `/api/characters/${character.id}`)).avatarUrl).toBe(saved.avatarUrl);
  });
}

async function makeAvatar(page, color) {
  return page.evaluate((fillStyle) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = fillStyle;
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/png');
  }, color);
}

async function expectAvatarPreview(page, avatarUrl) {
  const workspace = page.locator('.character-assistant-page');
  await expect(workspace.locator('.assistant-session-select[aria-current="page"]')).toBeEnabled();
  await expect(workspace.getByRole('button', { name: '保存角色', exact: true })).toBeEnabled();
  await workspace.getByRole('button', { name: '预览角色卡', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '角色卡预览' });
  const avatar = dialog.getByRole('img', { name: '角色头像', exact: true });
  if (avatarUrl) {
    await expect(avatar).toHaveAttribute('src', avatarUrl);
    await expect.poll(() => avatar.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  } else {
    await expect(avatar).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}
